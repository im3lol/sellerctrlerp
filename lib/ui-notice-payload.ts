import { createHash, randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { noticeKeys } from "@/lib/ui-notice-policy";

export const noticeCookieName = (path: string) => `sellerctrl_notice_${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
export const noticeCookieOptions = () => ({ path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 300 });

export function encodeNotice(path: string, input: Record<string, string>, now = Date.now()) {
  const values: Record<string, string> = {};
  for (const key of noticeKeys(path)) if (typeof input[key] === "string") {
    values[key] = input[key].slice(0, 600);
    while (Buffer.byteLength(JSON.stringify(values), "utf8") > 1800 && values[key].length) values[key] = values[key].slice(0, -1);
  }
  if (!Object.keys(values).length) return null;
  const id = randomBytes(12).toString("hex");
  return encryptSecret(JSON.stringify({ id, path, values, expires: now + 300000 }));
}

export function decodeNotice(value: string | undefined, path: string, now = Date.now()): { id: string; values: Record<string, string> } | null {
  try {
    const parts = (value || "").split(":");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(part => Buffer.from(part, "base64").toString("base64") !== part)) return null;
    const data = JSON.parse(decryptSecret(value || "") || "null");
    if (!data || data.path !== path || typeof data.id !== "string" || typeof data.expires !== "number" || data.expires <= now) return null;
    const values: Record<string, string> = {};
    for (const key of noticeKeys(path)) if (typeof data.values?.[key] === "string") values[key] = data.values[key];
    return { id: data.id, values };
  } catch { return null; }
}
