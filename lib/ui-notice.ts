import "server-only";
import { cookies } from "next/headers";
import { splitNoticeUrl, noticeKeys } from "@/lib/ui-notice-policy";
import { decodeNotice, encodeNotice, noticeCookieName, noticeCookieOptions } from "@/lib/ui-notice-payload";

/** Prepare a clean redirect target while retaining only an encrypted, short-lived UI notice. */
export async function noticeTarget(target: string): Promise<string> {
  const relative = target.startsWith("/") && !target.startsWith("//");
  const url = new URL(target, "https://notice.invalid");
  const { clean, values } = splitNoticeUrl(url);
  const encoded = encodeNotice(url.pathname, values);
  if (encoded) (await cookies()).set(noticeCookieName(url.pathname), encoded, noticeCookieOptions());
  return relative ? clean.pathname + clean.search + clean.hash : clean.href;
}

export async function getPageNotice(path: string) {
  const value = (await cookies()).get(noticeCookieName(path))?.value;
  return decodeNotice(value, path) ?? { id: "", values: {} as Record<string, string> };
}

export async function consumeNotice(path: string, id: string) {
  if (!noticeKeys(path).length) return;
  const jar = await cookies();
  const name = noticeCookieName(path);
  if (decodeNotice(jar.get(name)?.value, path)?.id === id) jar.set(name, "", { ...noticeCookieOptions(), maxAge: 0 });
}
