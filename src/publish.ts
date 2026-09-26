import { telegram } from "./telegram.js";
import type { Draft, Settings } from "./types.js";

export function keyboard(setting: Settings, downloadUrl: string) {
  const first = [] as Array<{ text: string; url: string }>;
  if (setting.backupUsername) first.push({ text: "★ ᴊᴏɪɴ ʙᴀᴄᴋᴜᴘ ★", url: `https://t.me/${setting.backupUsername.replace(/^@/, "")}` });
  if (setting.howToDownloadUrl) first.push({ text: "★ ʜᴏᴡ ᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ ★", url: setting.howToDownloadUrl });
  return { inline_keyboard: [first, [{ text: "★ ᴅᴏᴡʟᴏᴀᴅ ɴᴏᴡ ★", url: downloadUrl }]] };
}
export async function publish(draft: Draft, channelId: string, setting: Settings) {
  const reply_markup = keyboard(setting, draft.downloadUrl!);
  if (draft.media.type === "text") return telegram("sendMessage", { chat_id: channelId, text: draft.text || "‎", reply_markup });
  const method = `send${draft.media.type[0].toUpperCase()}${draft.media.type.slice(1)}`;
  const field = draft.media.type === "photo" ? "photo" : draft.media.type;
  return telegram(method, { chat_id: channelId, [field]: draft.media.fileId, caption: draft.text || undefined, reply_markup });
}
