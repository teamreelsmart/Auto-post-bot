import { MongoClient } from "mongodb";
import { config } from "./config.js";
import type { Draft, InputState, Settings } from "./types.js";

let client: MongoClient | undefined;
export async function database() {
  client ??= new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db();
  await db.collection<Settings>("settings").updateOne({ _id: "settings" }, { $setOnInsert: { backupUsername: "", howToDownloadUrl: "", removeLinks: false, channels: [], replacements: [] } }, { upsert: true });
  return db;
}
export async function settings() { return (await database()).collection<Settings>("settings"); }
export async function drafts() { return (await database()).collection<Draft>("drafts"); }
export async function states() { return (await database()).collection<InputState>("states"); }
export async function admins() { return (await database()).collection<{ userId: number }>("admins"); }
