export type Channel = { chatId: string; name: string; enabled: boolean };
export type Replacement = { from: string; to: string };
export type Settings = { _id: "settings"; backupUsername: string; howToDownloadUrl: string; removeLinks: boolean; channels: Channel[]; replacements: Replacement[] };
export type InputState = { userId: number; action: "add_admin" | "backup" | "howto" | "replace" | "add_channel" | "download" | "edit" | "schedule"; draftId?: string; expiresAt: Date };
export type Media = { type: "text" | "photo" | "video" | "document" | "animation" | "audio"; fileId?: string };
export type Draft = { _id: string; ownerId: number; media: Media; text: string; downloadUrl?: string; channelIds: string[]; status: "awaiting_download" | "review" | "scheduled" | "sending" | "sent" | "cancelled"; createdAt: Date; scheduledAt?: Date };
