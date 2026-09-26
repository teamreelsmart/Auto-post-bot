/**
 * Root entrypoint required by Vercel's Node.js preset.
 * Telegram traffic is handled by /api/webhook and scheduled work by /api/cron.
 */
export default function handler(_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  response.status(200).json({ service: "auto-post-bot", webhook: "/api/webhook" });
}
