import { NextResponse } from "next/server";
import { encodeNotice, noticeCookieName, noticeCookieOptions } from "@/lib/ui-notice-payload";
import { splitNoticeUrl } from "@/lib/ui-notice-policy";

export function attachResponseNotice(response: NextResponse, path: string, values: Record<string, string>) {
  const encoded = encodeNotice(path, values);
  if (encoded) response.cookies.set(noticeCookieName(path), encoded, noticeCookieOptions());
  return response;
}

export function noticeResponse(url: URL, status = 303) {
  const { clean, values } = splitNoticeUrl(url);
  return attachResponseNotice(NextResponse.redirect(clean, status), url.pathname, values);
}
