import { randomUUID } from "node:crypto";
import { admins, drafts, settings, states } from "./db.js";
import { config } from "./config.js";
import { extractMedia, transformText } from "./format.js";
import { publish } from "./publish.js";
import { answerCallback, sendMessage } from "./telegram.js";
import type { Draft, InputState } from "./types.js";

type Update = { message?: any; callback_query?: any };
const adminMenu = { inline_keyboard: [
  [{ text: "➕ Add Admin", callback_data: "admin:add" }, { text: "📦 Backup Channel", callback_data: "admin:backup" }],
  [{ text: "⬇️ How to Download", callback_data: "admin:howto" }, { text: "📢 Manage Channels", callback_data: "admin:channels" }],
  [{ text: "🔀 Replace Words", callback_data: "admin:replace" }, { text: "🔗 Remove Links", callback_data: "admin:links" }],
  [{ text: "🗓 Schedule Posts", callback_data: "admin:scheduled" }],
] };
const reviewMenu = (id: string) => ({ inline_keyboard: [
  [{ text: "Change Channel", callback_data: `draft:channels:${id}` }, { text: "Edit Post", callback_data: `draft:edit:${id}` }],
  [{ text: "Send", callback_data: `draft:send:${id}` }, { text: "Schedule", callback_data: `draft:schedule:${id}` }],
] });

async function isAdmin(userId: number) {
  if (userId === config.primaryAdminId) return true;
  return !!await (await admins()).findOne({ userId });
}
async function state(userId: number, action: InputState["action"], draftId?: string) {
  await (await states()).updateOne({ userId }, { $set: { userId, action, draftId, expiresAt: new Date(Date.now() + 15 * 60_000) } }, { upsert: true });
}
async function showChannels(chatId: number, draftId?: string) {
  const s = await (await settings()).findOne({ _id: "settings" });
  const selected = draftId ? (await (await drafts()).findOne({ _id: draftId }))?.channelIds || [] : [];
  const rows = s!.channels.map(c => draftId
    ? [{ text: `${selected.includes(c.chatId) ? "✅" : "⬜"} ${c.name}`, callback_data: `channel:${draftId}:${c.chatId}` }]
    : [{ text: `${c.enabled ? "✅" : "⬜"} ${c.name}`, callback_data: `channel:settings:${c.chatId}` }, { text: "🗑", callback_data: `removechannel:${c.chatId}` }]);
  if (!draftId) rows.push([{ text: "➕ Add channel", callback_data: "admin:addchannel" }]);
  await sendMessage(chatId, "Select channels. Tapping an existing channel toggles it; send a channel @username to add one.", { inline_keyboard: rows });
}
async function review(chatId: number, draft: Draft) {
  const setting = await (await settings()).findOne({ _id: "settings" });
  await publish(draft, String(chatId), setting!);
  await sendMessage(chatId, `Post preview ready. Selected channels: ${draft.channelIds.length}. Choose an action below.`, reviewMenu(draft._id));
}

export async function handleUpdate(update: Update) {
  const message = update.message;
  const callback = update.callback_query;
  const userId = message?.from?.id ?? callback?.from?.id;
  const chatId = message?.chat?.id ?? callback?.message?.chat?.id;
  if (!userId || !chatId) return;
  if (!await isAdmin(userId)) { if (message?.text?.startsWith("/")) await sendMessage(chatId, "This bot is for authorized admins only."); return; }
  if (callback) { await answerCallback(callback.id); return handleCallback(callback.data, chatId, userId); }
  const text = message.text || message.caption || "";
  if (text === "/start" || text === "/admin") { await sendMessage(chatId, "Admin panel", adminMenu); return; }
  const active = await (await states()).findOne({ userId, expiresAt: { $gt: new Date() } });
  if (active) { await consumeInput(active, text, chatId); return; }
  if (!message.forward_origin && !message.is_automatic_forward) { await sendMessage(chatId, "Forward a post to start, or use /admin for settings."); return; }
  const setting = await (await settings()).findOne({ _id: "settings" });
  const media = extractMedia(message);
  const draft: Draft = { _id: randomUUID(), ownerId: userId, media, text: transformText(text, setting!), channelIds: setting!.channels.filter(c => c.enabled).map(c => c.chatId), status: "awaiting_download", createdAt: new Date() };
  await (await drafts()).insertOne(draft);
  await state(userId, "download", draft._id);
  await sendMessage(chatId, "Post processed. Now send its download link.");
}

async function consumeInput(active: InputState, text: string, chatId: number) {
  const dbStates = await states();
  const s = await settings();
  if (active.action === "add_admin") {
    const userId = Number(text.trim()); if (!Number.isSafeInteger(userId)) return void await sendMessage(chatId, "Please send a valid numeric Telegram user ID.");
    await (await admins()).updateOne({ userId }, { $set: { userId } }, { upsert: true }); await dbStates.deleteOne({ userId: active.userId }); return void await sendMessage(chatId, "Admin added.");
  }
  if (active.action === "backup" || active.action === "howto") {
    const field = active.action === "backup" ? "backupUsername" : "howToDownloadUrl";
    if (active.action === "howto" && !/^https?:\/\//i.test(text)) return void await sendMessage(chatId, "Please send a valid http(s) URL.");
    await s.updateOne({ _id: "settings" }, { $set: { [field]: text.trim() } }); await dbStates.deleteOne({ userId: active.userId }); return void await sendMessage(chatId, "Setting saved.");
  }
  if (active.action === "replace") {
    const [from, ...rest] = text.split("=>"); const to = rest.join("=>").trim();
    if (!from?.trim() || !to) return void await sendMessage(chatId, "Use this format: old word => new word");
    await s.updateOne({ _id: "settings" }, { $push: { replacements: { from: from.trim(), to } } }); await dbStates.deleteOne({ userId: active.userId }); return void await sendMessage(chatId, "Replacement rule added.");
  }
  if (active.action === "add_channel") {
    const handle = text.trim();
    if (!/^@[A-Za-z0-9_]{5,}$/.test(handle)) return void await sendMessage(chatId, "Send a valid public channel username, for example @my_channel.");
    await s.updateOne({ _id: "settings" }, { $pull: { channels: { chatId: handle } } });
    await s.updateOne({ _id: "settings" }, { $push: { channels: { chatId: handle, name: handle, enabled: true } } });
    await dbStates.deleteOne({ userId: active.userId }); return void await sendMessage(chatId, `${handle} added and enabled. Make sure the bot is an admin in this channel.`);
  }
  if (active.action === "download") {
    if (!/^https?:\/\//i.test(text)) return void await sendMessage(chatId, "Please send a valid http(s) download URL.");
    const draft = await (await drafts()).findOneAndUpdate({ _id: active.draftId! }, { $set: { downloadUrl: text.trim(), status: "review" } }, { returnDocument: "after" });
    await dbStates.deleteOne({ userId: active.userId }); return void await review(chatId, draft!);
  }
  if (active.action === "edit") {
    const setting = await s.findOne({ _id: "settings" });
    const draft = await (await drafts()).findOneAndUpdate({ _id: active.draftId! }, { $set: { text: transformText(text, setting!) } }, { returnDocument: "after" });
    await dbStates.deleteOne({ userId: active.userId }); return void await review(chatId, draft!);
  }
  if (active.action === "schedule") {
    const date = new Date(text); if (Number.isNaN(date.valueOf()) || date <= new Date()) return void await sendMessage(chatId, "Send a future date/time in ISO format, e.g. 2026-10-01T18:30:00+05:30");
    await (await drafts()).updateOne({ _id: active.draftId! }, { $set: { status: "scheduled", scheduledAt: date } }); await dbStates.deleteOne({ userId: active.userId }); return void await sendMessage(chatId, `Scheduled for ${date.toISOString()}.`);
  }
}

async function handleCallback(data: string, chatId: number, userId: number) {
  const [scope, action, id] = data.split(":");
  if (scope === "admin") {
    if (action === "add") { await state(userId, "add_admin"); return void await sendMessage(chatId, "Send the new admin's numeric Telegram user ID."); }
    if (action === "backup") { await state(userId, "backup"); return void await sendMessage(chatId, "Send backup channel username, for example @my_backup."); }
    if (action === "howto") { await state(userId, "howto"); return void await sendMessage(chatId, "Send the how-to-download HTTPS URL."); }
    if (action === "replace") { const current = await (await settings()).findOne({ _id: "settings" }); const rows = current!.replacements.map((r, i) => [{ text: `${r.from} → ${r.to}`, callback_data: "noop" }, { text: "🗑", callback_data: `removereplace:${i}` }]); rows.push([{ text: "➕ Add rule", callback_data: "admin:addreplace" }]); return void await sendMessage(chatId, "Replacement rules:", { inline_keyboard: rows }); }
    if (action === "addreplace") { await state(userId, "replace"); return void await sendMessage(chatId, "Send a rule as: old word => new word"); }
    if (action === "links") { const s = await settings(); const current = await s.findOne({ _id: "settings" }); await s.updateOne({ _id: "settings" }, { $set: { removeLinks: !current!.removeLinks } }); return void await sendMessage(chatId, `Link removal is now ${!current!.removeLinks ? "ON" : "OFF"}.`); }
    if (action === "channels") return showChannels(chatId);
    if (action === "addchannel") { await state(userId, "add_channel"); return void await sendMessage(chatId, "Send a channel as @username. The bot must be an administrator there."); }
    if (action === "scheduled") { const items = await (await drafts()).find({ status: "scheduled" }).sort({ scheduledAt: 1 }).toArray(); return void await sendMessage(chatId, items.length ? items.map(d => `• ${d.channelIds.join(", ")} — ${d.scheduledAt?.toISOString()}`).join("\n") : "No scheduled posts."); }
  }
  if (scope === "removechannel") {
    await (await settings()).updateOne({ _id: "settings" }, { $pull: { channels: { chatId: action } } });
    return void await showChannels(chatId);
  }
  if (scope === "removereplace") {
    const current = await (await settings()).findOne({ _id: "settings" });
    const index = Number(action);
    if (Number.isInteger(index) && current!.replacements[index]) await (await settings()).updateOne({ _id: "settings" }, { $set: { replacements: current!.replacements.filter((_, i) => i !== index) } });
    return void await sendMessage(chatId, "Replacement rule deleted.");
  }
  if (scope === "noop") return;
  if (scope === "channel") {
    const target = id; const s = await settings();
    if (action === "settings") { const current = await s.findOne({ _id: "settings" }); const channel = current!.channels.find(c => c.chatId === target); if (channel) await s.updateOne({ _id: "settings", "channels.chatId": target }, { $set: { "channels.$.enabled": !channel.enabled } }); return showChannels(chatId); }
    const draft = await (await drafts()).findOne({ _id: action }); if (!draft) return;
    const selected = draft.channelIds.includes(target) ? draft.channelIds.filter(c => c !== target) : [...draft.channelIds, target];
    await (await drafts()).updateOne({ _id: draft._id }, { $set: { channelIds: selected } }); return showChannels(chatId, draft._id);
  }
  if (scope === "draft") {
    const draft = await (await drafts()).findOne({ _id: id, ownerId: userId }); if (!draft) return;
    if (action === "channels") return showChannels(chatId, id);
    if (action === "edit") { await state(userId, "edit", id); return void await sendMessage(chatId, "Send the new caption/text for this post."); }
    if (action === "schedule") { await state(userId, "schedule", id); return void await sendMessage(chatId, "Send a future ISO date/time, e.g. 2026-10-01T18:30:00+05:30"); }
    if (action === "send") {
      if (!draft.channelIds.length) return void await sendMessage(chatId, "Select at least one channel first.");
      const setting = await (await settings()).findOne({ _id: "settings" });
      await Promise.all(draft.channelIds.map(channelId => publish(draft, channelId, setting!)));
      await (await drafts()).updateOne({ _id: id }, { $set: { status: "sent" } }); return void await sendMessage(chatId, "Post sent successfully.");
    }
  }
}
