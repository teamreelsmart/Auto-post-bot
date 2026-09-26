import { config } from "../src/config.js";
import { drafts, settings } from "../src/db.js";
import { publish } from "../src/publish.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) return new Response("Unauthorized", { status: 401 });
  const collection = await drafts();
  const due = await collection.find({ status: "scheduled", scheduledAt: { $lte: new Date() } }).toArray();
  const setting = await (await settings()).findOne({ _id: "settings" });
  for (const draft of due) {
    const claim = await collection.updateOne({ _id: draft._id, status: "scheduled" }, { $set: { status: "sending" } });
    if (!claim.modifiedCount) continue;
    try { await Promise.all(draft.channelIds.map(channelId => publish(draft, channelId, setting!))); await collection.updateOne({ _id: draft._id }, { $set: { status: "sent" } }); }
    catch (error) { await collection.updateOne({ _id: draft._id }, { $set: { status: "scheduled" } }); console.error("Scheduled post failed", draft._id, error); }
  }
  return Response.json({ published: due.length });
}
