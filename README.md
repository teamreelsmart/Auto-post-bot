# Telegram Channel Post Preparer (Python)

This is a **Python long-polling Telegram bot**, not a webhook application. It is designed to run as a Render **Background Worker**. The start command is exactly:

```bash
python bot.py
```

## Features

* `/admin` is restricted to owners and admins. Owners are defined with `OWNER_IDS`; owners can add other admins.
* Add, choose, and remove multiple destination channels. The bot verifies it is a channel administrator before adding a channel.
* Forward a text, photo, video, document, or animation post. The bot removes URLs, replaces all Telegram usernames with the configured username, and applies multiple custom `old => new` replacements.
* Telegram formatting entities including bold, italic, code, spoiler, and block quotes are preserved when the automatic cleanup changes a caption.
* The bot asks for a download link, previews the prepared post with **Download Now**, **Join Backup**, and **How to Download** buttons, and offers **Send**, **Edit post**, and **Change channel** controls.
* MongoDB stores settings, administrator access, and in-progress drafts, so data survives a Render restart.

## Environment variables

Copy `.env.example` to `.env` for local use and set these on Render:

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | Yes | Token from @BotFather. |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string. |
| `OWNER_IDS` | Yes | Comma-separated numeric Telegram user IDs permitted to bootstrap administration. |

There is no `WEBHOOK_URL`, `WEBHOOK_SECRET`, or web server configuration because this bot intentionally uses Telegram long polling.

## Local setup

```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python bot.py
```

## Deploy to Render (no webhook)

1. Create a MongoDB Atlas database user and allow network access from Render. Copy the connection string as `MONGODB_URI`.
2. Push this project to GitHub and create a Render **Background Worker** (not a Web Service).
3. Select the Python runtime. Set **Build Command** to `pip install -r requirements.txt` and **Start Command** to `python bot.py`.
4. Add `BOT_TOKEN`, `MONGODB_URI`, and `OWNER_IDS` in Render's Environment settings, then deploy.
5. The included `render.yaml` declares the same worker settings if you use Render Blueprints. Never put real secrets in that file or commit `.env`.
6. Open the bot chat as an owner, run `/admin`, add the bot as administrator in each target channel, then add those channels through **Channels**.

The bot calls `delete_webhook` on startup and then continuously receives updates through long polling. Only run **one** instance for one bot token, otherwise Telegram will return a polling conflict.

## Notes

* Administrators must start a private chat with the bot before it can reply to them.
* Telegram protected-content posts cannot be forwarded. Original inline buttons may not be accessible to bots; the bot creates the three requested replacement buttons instead.
* Albums arrive as separate Telegram messages and should be forwarded individually.
