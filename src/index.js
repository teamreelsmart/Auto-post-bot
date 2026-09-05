import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import { Telegraf, Markup } from 'telegraf';
import { Administrator, Draft, Settings } from './models.js';
import { cleanPost } from './format.js';

const { BOT_TOKEN, MONGODB_URI, OWNER_IDS = '', WEBHOOK_URL, WEBHOOK_SECRET, PORT = 3000 } = process.env;
if (!BOT_TOKEN || !MONGODB_URI) throw new Error('BOT_TOKEN and MONGODB_URI are required. See .env.example.');
const owners = new Set(OWNER_IDS.split(',').map((x) => x.trim()).filter(Boolean));
const bot = new Telegraf(BOT_TOKEN);
const app = express();
const menu = Markup.inlineKeyboard([
  [Markup.button.callback('Channels', 'channels'), Markup.button.callback('Settings', 'settings')],
  [Markup.button.callback('Word replacements', 'words'), Markup.button.callback('Admins', 'admins')]
]);

async function admin(userId) { return owners.has(String(userId)) || Boolean(await Administrator.exists({ userId: String(userId) })); }
async function settings(userId) { return Settings.findOneAndUpdate({ userId: String(userId) }, { $setOnInsert: { userId: String(userId) } }, { upsert: true, new: true }); }
function mustAdmin(handler) { return async (ctx) => { if (!ctx.from || !(await admin(ctx.from.id))) return ctx.reply('This bot is only available to administrators.'); return handler(ctx); }; }
function channelButtons(s) { return Markup.inlineKeyboard([...s.channels.map((c) => [Markup.button.callback(`${c.chatId === s.selectedChannelId ? '✓ ' : ''}${c.title}`, `pick:${c.chatId}`), Markup.button.callback('Remove', `remove:${c.chatId}`)]), [Markup.button.callback('Add channel', 'addchannel')], [Markup.button.callback('Back', 'home')]]); }
function buttonsForDraft(d, s) { return Markup.inlineKeyboard([[Markup.button.url('Download Now', d.downloadUrl)], [Markup.button.url('Join Backup', `https://t.me/${(s.backupUsername || 'telegram').replace(/^@/, '')}`), Markup.button.url('How to Download', s.howToDownloadUrl || 'https://example.com')]]); }
async function deliver(ctx, draft, s) {
  const extra = { caption: draft.text || undefined, caption_entities: draft.entities, reply_markup: buttonsForDraft(draft, s).reply_markup };
  if (draft.kind === 'text') return ctx.telegram.sendMessage(draft.targetChannelId, draft.text, { entities: draft.entities, reply_markup: extra.reply_markup });
  return ctx.telegram[`send${draft.kind[0].toUpperCase()}${draft.kind.slice(1)}`](draft.targetChannelId, draft.fileId, extra);
}

bot.command('start', mustAdmin((ctx) => ctx.reply('Welcome. Forward a post to begin, or use /admin to configure this bot.')));
bot.command('admin', mustAdmin((ctx) => ctx.reply('Administration panel', menu)));
bot.action('home', mustAdmin((ctx) => ctx.editMessageText('Administration panel', menu)));
bot.action('channels', mustAdmin(async (ctx) => ctx.editMessageText('Select a destination channel. The bot must be an administrator in every channel.', channelButtons(await settings(ctx.from.id)))));
bot.action('settings', mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); return ctx.editMessageText(`Settings\nPublic username: ${s.publicUsername || 'not set'}\nBackup username: ${s.backupUsername || 'not set'}\nHow-to URL: ${s.howToDownloadUrl || 'not set'}`, Markup.inlineKeyboard([[Markup.button.callback('Set public username', 'set:publicUsername')], [Markup.button.callback('Set backup username', 'set:backupUsername')], [Markup.button.callback('Set how-to link', 'set:howToDownloadUrl')], [Markup.button.callback('Back', 'home')]])); }));
bot.action('words', mustAdmin((ctx) => ctx.editMessageText('Send replacements as `old => new`, one per line. They are case-insensitive and applied to every forwarded post.', Markup.inlineKeyboard([[Markup.button.callback('Set replacements', 'set:words')], [Markup.button.callback('Back', 'home')]]))));
bot.action('admins', mustAdmin((ctx) => ctx.editMessageText('Send a numeric Telegram user ID to add an administrator. Owners configured in OWNER_IDS are permanent.', Markup.inlineKeyboard([[Markup.button.callback('Add administrator', 'set:admin')], [Markup.button.callback('Back', 'home')]]))));
bot.action('addchannel', mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); s.flow = 'channel'; await s.save(); return ctx.reply('Send the channel @username or numeric chat ID. Add this bot as a channel administrator first.'); }));
bot.action(/^pick:(.+)$/, mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); s.selectedChannelId = ctx.match[1]; await s.save(); return ctx.answerCbQuery('Destination channel selected'); }));
bot.action(/^remove:(.+)$/, mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); s.channels = s.channels.filter((c) => c.chatId !== ctx.match[1]); if (s.selectedChannelId === ctx.match[1]) s.selectedChannelId = undefined; await s.save(); return ctx.editMessageText('Channel removed.', channelButtons(s)); }));
bot.action(/^set:(.+)$/, mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); s.flow = ctx.match[1]; await s.save(); return ctx.reply('Send the new value.'); }));
bot.action(/^send:(.+)$/, mustAdmin(async (ctx) => { const draft = await Draft.findOne({ _id: ctx.match[1], ownerId: String(ctx.from.id), status: 'ready' }); if (!draft) return ctx.answerCbQuery('This draft is no longer available.'); const s = await settings(ctx.from.id); await deliver(ctx, draft, s); draft.status = 'sent'; await draft.save(); return ctx.editMessageText('Sent to the selected channel.'); }));
bot.action(/^edit:(.+)$/, mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); s.flow = 'edit'; s.flowData = { draftId: ctx.match[1] }; await s.save(); return ctx.reply('Send the replacement caption/text. Formatting in the new text will be plain; the original formatting is preserved if you do not edit it.'); }));
bot.action(/^change:(.+)$/, mustAdmin(async (ctx) => { const s = await settings(ctx.from.id); const draft = await Draft.findOne({ _id: ctx.match[1], ownerId: String(ctx.from.id), status: 'ready' }); if (!draft) return ctx.answerCbQuery('Draft unavailable.'); return ctx.reply('Choose the new destination channel.', Markup.inlineKeyboard(s.channels.map((c) => [Markup.button.callback(c.title, `target:${draft._id}:${c.chatId}`)]))); }));
bot.action(/^target:([^:]+):(.+)$/, mustAdmin(async (ctx) => { const draft = await Draft.findOne({ _id: ctx.match[1], ownerId: String(ctx.from.id), status: 'ready' }); if (!draft) return ctx.answerCbQuery('Draft unavailable.'); draft.targetChannelId = ctx.match[2]; await draft.save(); return ctx.editMessageText('Destination updated. Use the Send button in the preview message when ready.'); }));

bot.on('message', mustAdmin(async (ctx) => {
  const s = await settings(ctx.from.id); const msg = ctx.message;
  if (s.flow) {
    const value = msg.text?.trim(); if (!value) return ctx.reply('Please send text for this setting.');
    if (s.flow === 'link') {
      if (!/^https?:\/\//i.test(value)) return ctx.reply('Please send a valid URL beginning with http:// or https://.');
      const draft = await Draft.findOne({ _id: s.flowData.draftId, ownerId: String(ctx.from.id), status: 'waiting_link' });
      if (!draft) { s.flow = null; await s.save(); return ctx.reply('That draft expired. Forward the post again.'); }
      draft.downloadUrl = value; draft.status = 'ready'; await draft.save(); s.flow = null; s.flowData = {}; await s.save();
      const extra = { caption: draft.text || undefined, caption_entities: draft.entities, reply_markup: buttonsForDraft(draft, s).reply_markup };
      if (draft.kind === 'text') await ctx.reply(draft.text || ' ', { entities: draft.entities, reply_markup: extra.reply_markup });
      else await ctx.telegram[`send${draft.kind[0].toUpperCase()}${draft.kind.slice(1)}`](ctx.chat.id, draft.fileId, extra);
      const target = s.channels.find((c) => c.chatId === draft.targetChannelId);
      return ctx.reply(`This post will be sent to: ${target?.title || draft.targetChannelId}`, Markup.inlineKeyboard([[Markup.button.callback('Send', `send:${draft._id}`), Markup.button.callback('Edit post', `edit:${draft._id}`), Markup.button.callback('Change channel', `change:${draft._id}`)]]));
    }
    if (s.flow === 'edit') {
      const draft = await Draft.findOne({ _id: s.flowData.draftId, ownerId: String(ctx.from.id), status: 'ready' });
      if (!draft) return ctx.reply('That draft is unavailable.');
      draft.text = value; draft.entities = []; await draft.save(); s.flow = null; s.flowData = {}; await s.save(); return ctx.reply('Draft text updated. Use the Send button in the existing confirmation message.');
    }
    if (s.flow === 'channel') { try { const chat = await ctx.telegram.getChat(value); s.channels.push({ chatId: String(chat.id), title: chat.title || value }); } catch { return ctx.reply('I could not access that channel. Check its ID and make this bot an administrator.'); } }
    else if (s.flow === 'admin') { if (!/^\d+$/.test(value)) return ctx.reply('Send a numeric user ID.'); await Administrator.updateOne({ userId: value }, { $set: { addedBy: String(ctx.from.id) } }, { upsert: true }); }
    else if (s.flow === 'words') s.replacements = value.split('\n').map((x) => x.split('=>').map((y) => y.trim())).filter((x) => x.length === 2 && x[0]).map(([from, to]) => ({ from, to }));
    else s[s.flow] = value;
    s.flow = null; await s.save(); return ctx.reply('Saved.');
  }
  if (msg.text && (msg.text.startsWith('/') || !msg.forward_origin)) return;
  if (!s.selectedChannelId) return ctx.reply('Choose a destination channel first: /admin → Channels.');
  const kind = msg.photo ? 'photo' : msg.video ? 'video' : msg.document ? 'document' : msg.animation ? 'animation' : 'text';
  const fileId = kind === 'photo' ? msg.photo.at(-1).file_id : kind === 'text' ? null : msg[kind].file_id;
  const rawText = msg.caption ?? msg.text ?? ''; const rawEntities = msg.caption_entities ?? msg.entities ?? [];
  const cleaned = cleanPost(rawText, rawEntities, s.publicUsername, s.replacements);
  const draft = await Draft.create({ ownerId: String(ctx.from.id), kind, fileId, text: cleaned.text, entities: cleaned.entities, targetChannelId: s.selectedChannelId });
  s.flow = 'link'; s.flowData = { draftId: String(draft._id) }; await s.save();
  return ctx.reply('Post received and cleaned. Please send the download link for its **Download Now** button.', { parse_mode: 'Markdown' });
}));

app.get('/', (_req, res) => res.status(200).send('Channel Post Preparer Bot is running.'));

async function start() {
  await mongoose.connect(MONGODB_URI);
  const port = Number(PORT);
  if (WEBHOOK_URL) {
    if (!WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET is required when WEBHOOK_URL is set.');
    const path = `/${WEBHOOK_SECRET}`;
    app.use(path, bot.webhookCallback(path));
    await bot.telegram.setWebhook(`${WEBHOOK_URL.replace(/\/$/, '')}${path}`);
    app.listen(port, () => console.log(`Webhook health server listening on ${port}`));
  } else {
    await bot.launch();
    app.listen(port, () => console.log(`Polling health server listening on ${port}`));
  }
}

start().catch((error) => { console.error(error); process.exit(1); });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
