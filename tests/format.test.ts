import { describe, expect, it } from "vitest";
import { transformText } from "../src/format.js";

describe("transformText", () => {
  const base = { _id: "settings" as const, backupUsername: "", howToDownloadUrl: "", channels: [], replacements: [{ from: "Telegram", to: "Instagram" }] };
  it("replaces configured words", () => expect(transformText("Telegram post", { ...base, removeLinks: false })).toBe("Instagram post"));
  it("removes visible URLs when enabled", () => expect(transformText("See https://example.com now", { ...base, removeLinks: true })).toBe("See  now"));
});
