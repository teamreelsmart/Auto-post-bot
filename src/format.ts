import type { Media, Settings } from "./types.js";

export function transformText(value: string, setting: Settings) {
  let output = value;
  for (const rule of setting.replacements) output = output.replaceAll(rule.from, rule.to);
  if (setting.removeLinks) {
    output = output.replace(/(?:https?:\/\/|www\.)\S+/gi, "").replace(/(?:t\.me|telegram\.me)\/\S+/gi, "");
  }
  return output.replace(/\n{3,}/g, "\n\n").trim();
}
export function extractMedia(message: Record<string, any>): Media {
  if (message.photo) return { type: "photo", fileId: message.photo.at(-1)?.file_id };
  if (message.video) return { type: "video", fileId: message.video.file_id };
  if (message.document) return { type: "document", fileId: message.document.file_id };
  if (message.animation) return { type: "animation", fileId: message.animation.file_id };
  if (message.audio) return { type: "audio", fileId: message.audio.file_id };
  return { type: "text" };
}
