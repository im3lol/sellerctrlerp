import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed customer links (/d/<token>): a quotation or an invoice a customer can open
 * without an account. The token carries the org, the kind and the document id, and
 * expires; the HMAC is taken over a "doc-link:" context so no other token signed with the
 * same secret (the OAuth state, say) can ever be replayed as a document link.
 */

export type DocLinkKind = "SI" | "QT";
export type DocLink = { o: string; k: DocLinkKind; id: string; exp: number };

export const LINK_DAYS = 30;
const b64url = (b: Buffer) => b.toString("base64url");
const mac = (secret: string, body: string) => b64url(createHmac("sha256", secret).update(`doc-link:${body}`).digest());

export function signDocLink(secret: string, p: Omit<DocLink, "exp">, now = Date.now(), days = LINK_DAYS): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...p, exp: now + days * 86_400_000 } satisfies DocLink)));
  return `${body}.${mac(secret, body)}`;
}

export function verifyDocLink(secret: string, token: string, now = Date.now()): DocLink | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(secret, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as DocLink;
    if (!p.o || !p.id || (p.k !== "SI" && p.k !== "QT") || !(p.exp > now)) return null;
    return p;
  } catch {
    return null;
  }
}

/** The app's secret for links. No fallback: an unsigned-able link must fail loudly, not quietly. */
export function docLinkSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set to sign customer links");
  return s;
}

/** A full link for a document, for the share menu. */
export function docLinkUrl(origin: string, p: Omit<DocLink, "exp">): string {
  return `${origin.replace(/\/$/, "")}/d/${signDocLink(docLinkSecret(), p)}`;
}
