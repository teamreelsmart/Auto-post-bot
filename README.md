# Channel Post Preparer Bot

An English-language Telegram bot that lets approved admins forward a post, cleans its caption without losing Telegram formatting, and prepares it for a selected channel. It supports text, photos, videos, documents, and animations.

## What it does

* Only owners and administrators can use the bot. Open **`/admin`** to access the control panel.
* Add several destination channels, select one, or remove channels. The bot checks access when a channel is added.
* Forward a post to the bot. It removes visible HTTP(S) links and rich-text links, replaces `@usernames` with the configured public username, and applies any number of case-insensitive `old => new` word replacements.
* Telegram caption entities (bold, italic, underline, spoiler, code, block quote, and so on) are retained whenever text is transformed. If an admin manually edits the draft, that new text is intentionally plain.
* The bot asks for the download link, then previews the cleaned post with **Download Now**, **Join Backup**, and **How to Download** buttons.
* The following confirmation offers **Send**, **Edit post**, and **Change channel**. Sending publishes only to the channel selected for that draft.

## Telegram setup

1. Create a bot through **@BotFather** and copy its token.
2. Start a private chat with the bot from every administrator account (Telegram bots cannot message a user who has never started them).
3. Add the bot to every destination channel as an **administrator** with permission to post messages. Then use `/admin` → **Channels** → **Add channel** and send its `@channelusername` or numeric chat ID.
4. Find your own numeric Telegram user ID (for example via an ID-info bot) and put it in `OWNER_IDS`. Owners are the first admins and cannot be removed through the UI.
5. In `/admin` → **Settings**, configure the replacement public username, backup username, and how-to-download URL. In **Word replacements**, send entries such as:

   ```text
   Telegram => Instagram
   old name => New Name
   ```

6. Owners may use `/admin` → **Admins** to add more admins by numeric Telegram user ID.

## Local run

```bash
cp .env.example .env
npm install
npm start
```

When `WEBHOOK_URL` is empty the bot uses long polling, which is convenient locally. Do not run a local polling instance while the production webhook is active.

## MongoDB Atlas

1. Create a free MongoDB Atlas cluster and database user.
2. In Atlas **Network Access**, allow Render to connect (for a simple first deployment, `0.0.0.0/0`; use a tighter rule if available to you).
3. Copy the driver connection string, replace its password, and use it as `MONGODB_URI`. The application creates its collections automatically.

## Render deployment guide

1. Push this repository to GitHub, then select **New → Web Service** in Render and connect the repository.
2. Choose **Node**. Set Build Command to `npm install` and Start Command to `npm start`.
3. Add these environment variables in Render:

   | Variable | Value |
   | --- | --- |
   | `BOT_TOKEN` | Token supplied by BotFather |
   | `MONGODB_URI` | MongoDB Atlas connection string |
   | `OWNER_IDS` | One or more comma-separated numeric Telegram user IDs |
   | `WEBHOOK_URL` | The final Render public URL, for example `https://my-post-bot.onrender.com` |
   | `WEBHOOK_SECRET` | A long random, URL-safe value (for example 32+ random characters) |
   | `PORT` | Leave unset; Render supplies it automatically |

4. Deploy. On startup the app connects to MongoDB and registers `https://your-service/<WEBHOOK_SECRET>` with Telegram automatically. The `/` endpoint returns a health response for Render.
5. After a redeploy, open `/admin` in Telegram and verify your configuration. Render free services can sleep, so the first incoming update after inactivity may take longer; a paid always-on instance avoids this delay.

## Important notes

* Never commit `.env`, your token, or MongoDB password. `.env.example` contains names only.
* Telegram only provides a bot the post content it receives. Some protected-content channels cannot be forwarded, and Telegram may not expose original inline keyboard buttons; this bot creates the requested replacement buttons instead.
* A forwarded post must include text or one of the supported single media types. Albums are handled by Telegram as separate messages and should be forwarded item by item.
