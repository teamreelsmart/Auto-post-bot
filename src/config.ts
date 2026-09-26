const required = ["BOT_TOKEN", "PRIMARY_ADMIN_ID", "MONGODB_URI", "WEBHOOK_SECRET", "CRON_SECRET"] as const;

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  botToken: process.env.BOT_TOKEN!,
  primaryAdminId: Number(process.env.PRIMARY_ADMIN_ID!),
  mongoUri: process.env.MONGODB_URI!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  cronSecret: process.env.CRON_SECRET!,
  timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
};
