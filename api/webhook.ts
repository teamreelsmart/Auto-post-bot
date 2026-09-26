import { config } from "../src/config.js";
import { handleUpdate } from "../src/bot.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== config.webhookSecret) return new Response("Unauthorized", { status: 401 });
  await handleUpdate(await request.json());
  return Response.json({ ok: true });
}
