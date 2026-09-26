import { config } from "../src/config.js";
import { drafts, settings } from "../src/db.js";
import { publish } from "../src/publish.js";

type Request = { headers: Record<string, string | string[] | undefined> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void };

/** Vercel Node.js Serverless Function invoked by the Vercel Cron schedule. */
export default async function handler(request: Request, response: Response) {
  if (request.headers.authorization !== `Bearer ${config.cronSecret}`) return response.status(401).json({ error: "Unauthorized" });
  const collection = await drafts();
  const due = await collection.find({ status: "scheduled", scheduledAt: { $lte: new Date() } }).toArray();
  const setting = await (await settings()).findOne({ _id: "settings" });
  for (const draft of due) {
    const claim = await collection.updateOne({ _id: draft._id, status: "scheduled" }, { $set: { status: "sending" } });
    if (!claim.modifiedCount) continue;
    try { await Promise.all(draft.channelIds.map(channelId => publish(draft, channelId, setting!))); await collection.updateOne({ _id: draft._id }, { $set: { status: "sent" } }); }
    catch (error) { await collection.updateOne({ _id: draft._id }, { $set: { status: "scheduled" } }); console.error("Scheduled post failed", draft._id, error); }
  }
  return response.status(200).json({ published: due.length });
}
