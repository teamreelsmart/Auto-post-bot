import { config } from "./config.js";

type Keyboard = { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> };
export async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json() as { ok: boolean; result: T; description?: string };
  if (!body.ok) throw new Error(`Telegram ${method}: ${body.description || "unknown error"}`);
  return body.result;
}
export const sendMessage = (chatId: number | string, text: string, reply_markup?: Keyboard) => telegram("sendMessage", { chat_id: chatId, text, reply_markup });
export const answerCallback = (id: string, text?: string) => telegram("answerCallbackQuery", { callback_query_id: id, text });
