# Auto Post Bot

A Telegram administration bot that receives forwarded posts, applies your caption rules, adds download buttons, then sends or schedules the post to one or more channels. It is designed for **Vercel serverless functions**, Telegram webhooks, and MongoDB.

## Features

- `/admin` inline control panel, restricted to a primary administrator and additional admins.
- Add extra admins by numeric Telegram user ID.
- Configure backup channel, how-to-download URL, destination channels, link removal, and multiple caption replacement rules.
- Forward text, photos, videos, documents, animations, and audio to the bot.
- Remove URLs and replace configured words in captions/text before publishing.
- Collect a per-post download link and add these post buttons:
  - `★ ᴊᴏɪɴ ʙᴀᴄᴋᴜᴘ ★`
  - `★ ʜᴏᴡ ᴛᴏ ᴅᴏᴡʟᴏᴀᴅ ★`
  - `★ ᴅᴏᴡʟᴏᴀᴅ ɴᴏᴡ ★`
- Select target channels, edit the text/caption, send immediately, or schedule posts.
- View pending items through **Schedule Posts** in `/admin`.

## Prerequisites

1. Node.js 20 or newer.
2. A [Telegram BotFather](https://t.me/BotFather) bot token.
3. A MongoDB Atlas database (or another MongoDB deployment reachable from Vercel).
4. A Vercel account and a Git repository containing this project.
5. Add the bot as an **administrator** in every destination channel, with permission to post messages.

## Local setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```env
BOT_TOKEN=123456:telegram-bot-token
PRIMARY_ADMIN_ID=123456789
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster.example.mongodb.net/auto-post-bot
WEBHOOK_SECRET=use-a-long-random-string
CRON_SECRET=use-a-different-long-random-string
APP_TIMEZONE=Asia/Kolkata
```

### Find your Telegram user ID

Message a trusted Telegram ID bot such as `@userinfobot`, then copy the numeric ID it reports. Set that value as `PRIMARY_ADMIN_ID`; this account can open `/admin` and add other admins.

## Deploy to Vercel

1. Push the project to GitHub, GitLab, or Bitbucket.
2. In Vercel, choose **Add New → Project**, import the repository, and deploy it as a Node.js project.
3. In **Project Settings → Environment Variables**, add every value from `.env.example`. Add them for Production (and Preview if desired).
4. Redeploy after saving the variables.
5. Copy the production URL, for example `https://your-project.vercel.app`.
6. Register the Telegram webhook (replace the placeholders):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  --data-urlencode "url=https://your-project.vercel.app/api/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
```

7. Confirm it is active:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

The included `vercel.json` runs `/api/cron` every minute. Vercel invokes cron jobs with the configured `CRON_SECRET`; the route rejects requests without `Authorization: Bearer <CRON_SECRET>`. Scheduled posts are stored in MongoDB and published once their due time arrives.

> **Vercel plan note:** Confirm that your Vercel plan supports one-minute cron schedules. If it does not, change the schedule in `vercel.json` to a supported interval; scheduled messages may then be published up to that interval late.

## First-time bot configuration

1. Open a private chat with the bot as the primary admin and send `/admin`.
2. Choose **Backup Channel** and send a public username such as `@my_backup`.
3. Choose **How to Download** and send a complete `https://...` URL.
4. Choose **Manage Channels → Add channel** and send each public destination `@username`. Use the channel toggle to control its default inclusion.
5. Choose **Replace Words** to add rules in the format `Telegram => Instagram`. The same menu lets you delete rules.
6. Use **Remove Links** to switch URL removal on or off.
7. Use **Add Admin** to authorize other numeric Telegram user IDs.

## Posting workflow

1. Forward a supported post to the bot from an authorized admin account.
2. The bot applies replacement and URL-removal settings, then asks for the download URL.
3. Send a complete `http://` or `https://` download URL.
4. On the review message, choose:
   - **Change Channel** to pick this post's destinations.
   - **Edit Post** to replace its processed text/caption.
   - **Send** to publish now.
   - **Schedule** to send a future ISO-8601 time, for example `2026-10-01T18:30:00+05:30`.
5. Open `/admin → Schedule Posts` to see scheduled destination channels and dates.

## Important limits

- Telegram cannot give a bot access to content protected by Telegram's forwarding/copying restrictions. Forwarded content must be deliverable to the bot.
- Public `@channel_username` destination channels are supported in the admin interface. For private channels, adapt the channel flow to store their numeric chat ID after obtaining it through a bot update.
- The bot publishes supported single messages; Telegram albums are not combined into a media group in this initial version.
- Link removal operates on visible plain URLs in the caption/text. Telegram entity-level text links are not retained because the post is sent with transformed plain text.

## Checks

```bash
npm run typecheck
npm run lint
npm test
```
