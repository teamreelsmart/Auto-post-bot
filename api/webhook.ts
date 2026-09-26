import { config } from "../src/config.js";
import { handleUpdate } from "../src/bot.js";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { status: (code: number) => Response; json: (body: unknown) => void };

/** Vercel Node.js Serverless Function for Telegram webhook updates. */
export default async function handler(request: Request, response: Response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (request.headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret) return response.status(401).json({ error: "Unauthorized" });
  await handleUpdate(request.body as Parameters<typeof handleUpdate>[0]);
  return response.status(200).json({ ok: true });
}
