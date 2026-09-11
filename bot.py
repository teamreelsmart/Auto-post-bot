"""Long-polling Telegram channel post preparer bot for Render workers."""
import asyncio
import os
import re
from copy import deepcopy
from datetime import datetime, timezone

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.types import (CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
                           Message, MessageEntity)
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
MONGODB_URI = os.getenv("MONGODB_URI")
OWNERS = {item.strip() for item in os.getenv("OWNER_IDS", "").split(",") if item.strip()}
if not TOKEN or not MONGODB_URI:
    raise RuntimeError("BOT_TOKEN and MONGODB_URI are required. Copy .env.example to .env.")

mongo = AsyncIOMotorClient(MONGODB_URI)
db = mongo["channel_post_preparer"]
router = Router()
URL_RE = re.compile(r'(?:https?://|www\.)[^\s<>"\']+', re.IGNORECASE)
USERNAME_RE = re.compile(r"(?<![\w@])@[a-zA-Z0-9_]{5,32}\b")


def u16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def u16_offset(value: str, index: int) -> int:
    return u16_length(value[:index])


def entity_dict(entity: MessageEntity) -> dict:
    data = entity.model_dump(exclude_none=True)
    # Telegram API accepts this serializable representation when revalidated below.
    return data


def replace_matches(text: str, entities: list[dict], pattern: re.Pattern, replacement) -> tuple[str, list[dict]]:
    """Replace from right to left so Telegram UTF-16 entity positions remain correct."""
    for match in reversed(list(pattern.finditer(text))):
        start = u16_offset(text, match.start())
        old_length = u16_length(match.group())
        new = replacement(match.group()) if callable(replacement) else replacement
        new_length = u16_length(new)
        end = start + old_length
        text = f"{text[:match.start()]}{new}{text[match.end():]}"
        changed = []
        for item in entities:
            item = deepcopy(item)
            item_end = item["offset"] + item["length"]
            if item["offset"] >= end:
                item["offset"] += new_length - old_length
            elif item_end <= start:
                pass
            elif item["offset"] <= start and item_end >= end:
                item["length"] += new_length - old_length
            else:
                continue
            if item["length"] > 0:
                changed.append(item)
        entities = changed
    return text, entities


def remove_entity_range(text: str, entities: list[dict], start: int, length: int) -> tuple[str, list[dict]]:
    """Remove a UTF-16 range and rebase intersecting entities."""
    encoded = text.encode("utf-16-le")
    before = encoded[:start * 2].decode("utf-16-le")
    after = encoded[(start + length) * 2:].decode("utf-16-le")
    end, changed = start + length, []
    for item in entities:
        item = deepcopy(item)
        item_end = item["offset"] + item["length"]
        if item_end <= start:
            changed.append(item)
        elif item["offset"] >= end:
            item["offset"] -= length
            changed.append(item)
        elif item["offset"] < start and item_end > end:
            item["length"] -= length
            changed.append(item)
        elif item["offset"] < start:
            item["length"] = start - item["offset"]
            changed.append(item)
        elif item_end > end:
            item["offset"], item["length"] = start, item_end - end
            changed.append(item)
    return before + after, [item for item in changed if item["length"] > 0]


def clean_post(text: str, original_entities: list[MessageEntity], username: str | None, replacements: list[dict]):
    entities = [entity_dict(entity) for entity in original_entities]
    # Remove URL and text_link entity labels first. Reverse order preserves positions.
    for entity in reversed(entities.copy()):
        if entity["type"] in {"url", "text_link"}:
            text, entities = remove_entity_range(text, entities, entity["offset"], entity["length"])
    text, entities = replace_matches(text, entities, URL_RE, "")
    if username:
        replacement = username if username.startswith("@") else f"@{username}"
        text, entities = replace_matches(text, entities, USERNAME_RE, replacement)
    for rule in replacements:
        source = rule.get("from", "")
        if source:
            text, entities = replace_matches(text, entities, re.compile(re.escape(source), re.IGNORECASE), rule.get("to", ""))
    return text, [MessageEntity.model_validate(item) for item in entities]


async def is_admin(user_id: int) -> bool:
    return str(user_id) in OWNERS or await db.administrators.find_one({"user_id": str(user_id)}) is not None


async def require_admin(message: Message) -> bool:
    if message.from_user and await is_admin(message.from_user.id):
        return True
    await message.answer("This bot is only available to administrators.")
    return False


async def settings(user_id: int) -> dict:
    return await db.settings.find_one_and_update({"user_id": str(user_id)}, {"$setOnInsert": {"user_id": str(user_id), "channels": [], "replacements": [], "flow": None, "flow_data": {}}}, upsert=True, return_document=ReturnDocument.AFTER)


def panel() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Channels", callback_data="channels"), InlineKeyboardButton(text="Settings", callback_data="settings")],
        [InlineKeyboardButton(text="Word replacements", callback_data="words"), InlineKeyboardButton(text="Admins", callback_data="admins")],
    ])


def post_buttons(draft: dict, config: dict) -> InlineKeyboardMarkup:
    backup = (config.get("backup_username") or "telegram").lstrip("@")
    how_to = config.get("how_to_download_url") or "https://example.com"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Download Now", url=draft["download_url"])],
        [InlineKeyboardButton(text="Join Backup", url=f"https://t.me/{backup}"), InlineKeyboardButton(text="How to Download", url=how_to)],
    ])


def confirm_buttons(draft_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Send", callback_data=f"send:{draft_id}"), InlineKeyboardButton(text="Edit post", callback_data=f"edit:{draft_id}"), InlineKeyboardButton(text="Change channel", callback_data=f"change:{draft_id}")]])


async def send_draft(bot: Bot, chat_id: int | str, draft: dict, config: dict):
    keyboard = post_buttons(draft, config)
    entities = [MessageEntity.model_validate(item) for item in draft.get("entities", [])]
    if draft["kind"] == "text":
        return await bot.send_message(chat_id, draft["text"] or " ", entities=entities, reply_markup=keyboard)
    method = getattr(bot, f"send_{draft['kind']}")
    return await method(chat_id, draft["file_id"], caption=draft["text"] or None, caption_entities=entities, reply_markup=keyboard)


@router.message(Command("start", "admin"))
async def admin_panel(message: Message):
    if await require_admin(message):
        await message.answer("Administration panel. Forward a post after configuring a destination channel.", reply_markup=panel())


@router.callback_query(F.data == "channels")
async def channels(callback: CallbackQuery):
    if not callback.from_user or not await is_admin(callback.from_user.id): return await callback.answer("Administrators only", show_alert=True)
    config = await settings(callback.from_user.id)
    rows = [[InlineKeyboardButton(text=("✓ " if c["chat_id"] == config.get("selected_channel_id") else "") + c["title"], callback_data=f"pick:{c['chat_id']}"), InlineKeyboardButton(text="Remove", callback_data=f"remove:{c['chat_id']}")] for c in config["channels"]]
    rows += [[InlineKeyboardButton(text="Add channel", callback_data="add_channel")], [InlineKeyboardButton(text="Back", callback_data="home")]]
    await callback.message.edit_text("Select a destination channel. The bot must be an administrator in every channel.", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows)); await callback.answer()


@router.callback_query(F.data == "home")
async def home(callback: CallbackQuery):
    if callback.from_user and await is_admin(callback.from_user.id): await callback.message.edit_text("Administration panel", reply_markup=panel())
    await callback.answer()


@router.callback_query(F.data.in_({"settings", "words", "admins", "add_channel"}) | F.data.startswith("set:"))
async def configure(callback: CallbackQuery):
    if not callback.from_user or not await is_admin(callback.from_user.id): return await callback.answer("Administrators only", show_alert=True)
    action = callback.data
    prompts = {"add_channel": ("channel", "Send the channel @username or numeric ID. Add the bot as channel administrator first."), "words": ("words", "Send replacements as `old => new`, one per line."), "admins": ("admin", "Send the numeric Telegram user ID to add as an administrator."), "settings": (None, "Choose a setting to update.")}
    if action == "settings":
        markup = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Public username", callback_data="set:public_username")], [InlineKeyboardButton(text="Backup username", callback_data="set:backup_username")], [InlineKeyboardButton(text="How-to-download link", callback_data="set:how_to_download_url")], [InlineKeyboardButton(text="Back", callback_data="home")]])
        await callback.message.edit_text(prompts[action][1], reply_markup=markup); return await callback.answer()
    flow, prompt = (action[4:], "Send the new value.") if action.startswith("set:") else prompts[action]
    await db.settings.update_one({"user_id": str(callback.from_user.id)}, {"$set": {"flow": flow, "flow_data": {}}}, upsert=True)
    await callback.message.answer(prompt); await callback.answer()


@router.callback_query(F.data.startswith("pick:") | F.data.startswith("remove:"))
async def channel_action(callback: CallbackQuery):
    if not callback.from_user or not await is_admin(callback.from_user.id): return await callback.answer("Administrators only", show_alert=True)
    action, chat_id = callback.data.split(":", 1)
    config = await settings(callback.from_user.id)
    update = {"$set": {"selected_channel_id": chat_id}} if action == "pick" else {"$pull": {"channels": {"chat_id": chat_id}}}
    if action == "remove" and config.get("selected_channel_id") == chat_id: update["$unset"] = {"selected_channel_id": ""}
    await db.settings.update_one({"user_id": str(callback.from_user.id)}, update)
    await callback.answer("Channel selected" if action == "pick" else "Channel removed")
    await channels(callback)


@router.message()
async def incoming(message: Message, bot: Bot):
    if not await require_admin(message): return
    config = await settings(message.from_user.id)
    value = (message.text or "").strip()
    flow = config.get("flow")
    if flow:
        if not value: return await message.answer("Please send text for this setting.")
        if flow == "channel":
            try:
                chat = await bot.get_chat(value)
                member = await bot.get_chat_member(chat.id, bot.id)
                if member.status not in {"administrator", "creator", "owner"}: raise ValueError
                await db.settings.update_one({"user_id": config["user_id"]}, {"$addToSet": {"channels": {"chat_id": str(chat.id), "title": chat.title or value}}, "$set": {"flow": None}})
            except Exception: return await message.answer("I could not access that channel as an administrator. Check its ID and permissions.")
        elif flow == "admin":
            if not value.isdigit(): return await message.answer("Send a numeric Telegram user ID.")
            await db.administrators.update_one({"user_id": value}, {"$set": {"added_by": config["user_id"]}}, upsert=True)
            await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {"flow": None}})
        elif flow == "words":
            rules = []
            for line in value.splitlines():
                if "=>" in line:
                    old, new = (part.strip() for part in line.split("=>", 1))
                    if old: rules.append({"from": old, "to": new})
            await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {"replacements": rules, "flow": None}})
        elif flow == "link":
            if not re.match(r"https?://", value, re.I): return await message.answer("Send a valid URL starting with http:// or https://.")
            from bson import ObjectId
            draft = await db.drafts.find_one_and_update({"_id": ObjectId(config["flow_data"]["draft_id"]), "owner_id": config["user_id"], "status": "waiting_link"}, {"$set": {"download_url": value, "status": "ready"}}, return_document=ReturnDocument.AFTER)
            if not draft: return await message.answer("That draft is unavailable. Forward the post again.")
            await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {"flow": None, "flow_data": {}}})
            await send_draft(bot, message.chat.id, draft, config)
            target = next((c for c in config["channels"] if c["chat_id"] == draft["target_channel_id"]), None)
            return await message.answer(f"This post will be sent to: {target['title'] if target else draft['target_channel_id']}", reply_markup=confirm_buttons(str(draft["_id"])))
        elif flow == "edit":
            from bson import ObjectId
            await db.drafts.update_one({"_id": ObjectId(config["flow_data"]["draft_id"]), "owner_id": config["user_id"], "status": "ready"}, {"$set": {"text": value, "entities": []}})
            await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {"flow": None, "flow_data": {}}})
        else:
            await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {flow: value, "flow": None}})
        return await message.answer("Saved.")
    if not getattr(message, "forward_origin", None): return
    if not config.get("selected_channel_id"): return await message.answer("Choose a destination channel first: /admin → Channels.")
    kind = "photo" if message.photo else "video" if message.video else "document" if message.document else "animation" if message.animation else "text"
    file_id = message.photo[-1].file_id if kind == "photo" else getattr(message, kind).file_id if kind != "text" else None
    text, entities = clean_post(message.caption or message.text or "", message.caption_entities or message.entities or [], config.get("public_username"), config.get("replacements", []))
    draft = {"owner_id": config["user_id"], "kind": kind, "file_id": file_id, "text": text, "entities": [entity.model_dump(exclude_none=True) for entity in entities], "target_channel_id": config["selected_channel_id"], "status": "waiting_link", "created_at": datetime.now(timezone.utc)}
    result = await db.drafts.insert_one(draft)
    await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {"flow": "link", "flow_data": {"draft_id": str(result.inserted_id)}}})
    await message.answer("Post received and cleaned. Send the download link for the Download Now button.")


@router.callback_query(F.data.startswith("send:") | F.data.startswith("edit:") | F.data.startswith("change:") | F.data.startswith("target:"))
async def draft_action(callback: CallbackQuery, bot: Bot):
    if not callback.from_user or not await is_admin(callback.from_user.id): return await callback.answer("Administrators only", show_alert=True)
    from bson import ObjectId
    parts = callback.data.split(":")
    action, draft_id = parts[0], parts[1]
    config = await settings(callback.from_user.id)
    draft = await db.drafts.find_one({"_id": ObjectId(draft_id), "owner_id": config["user_id"], "status": "ready"})
    if not draft: return await callback.answer("Draft unavailable", show_alert=True)
    if action == "send":
        await send_draft(bot, draft["target_channel_id"], draft, config); await db.drafts.update_one({"_id": draft["_id"]}, {"$set": {"status": "sent"}})
        await callback.message.edit_text("Sent to the selected channel."); return await callback.answer()
    if action == "edit":
        await db.settings.update_one({"user_id": config["user_id"]}, {"$set": {"flow": "edit", "flow_data": {"draft_id": draft_id}}})
        await callback.message.answer("Send the replacement caption/text. New text will be plain formatting."); return await callback.answer()
    if action == "change":
        rows = [[InlineKeyboardButton(text=c["title"], callback_data=f"target:{draft_id}:{c['chat_id']}")] for c in config["channels"]]
        await callback.message.answer("Choose the destination channel.", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows)); return await callback.answer()
    await db.drafts.update_one({"_id": draft["_id"]}, {"$set": {"target_channel_id": parts[2]}})
    await callback.message.edit_text("Destination updated. Use Send in the existing confirmation message."); await callback.answer()


async def main():
    await db.settings.create_index("user_id", unique=True)
    await db.administrators.create_index("user_id", unique=True)
    bot = Bot(TOKEN)
    dispatcher = Dispatcher(); dispatcher.include_router(router)
    await bot.delete_webhook(drop_pending_updates=False)
    await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())


if __name__ == "__main__":
    asyncio.run(main())
