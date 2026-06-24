import crypto from "node:crypto";

// HMAC key for hashing activation codes at rest. Set LICENSE_SECRET in prod;
// codes are 80-bit random regardless, so they are infeasible to guess even
// without the secret — the HMAC just hardens against a DB leak.
const SECRET = process.env.LICENSE_SECRET || process.env.AUTH_SECRET || "sellerctrl-license-key-v1";

/** Strip formatting and uppercase, so entry is tolerant of dashes/spaces/case. */
function normalize(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** A fresh 80-bit code formatted as XXXX-XXXX-XXXX-XXXX-XXXX. */
export function generateCode(): string {
  const hex = crypto.randomBytes(10).toString("hex").toUpperCase();
  return hex.match(/.{1,4}/g)!.join("-");
}

/** HMAC-SHA256 of the normalized code — the only form stored in the DB. */
export function hashCode(code: string): string {
  return crypto.createHmac("sha256", SECRET).update(normalize(code)).digest("hex");
}

/** Masked form for display, revealing only the last group: ••••-…-7G8H. */
export function codeHint(code: string): string {
  const groups = code.split("-");
  return groups.map((g, i) => (i === groups.length - 1 ? g : "••••")).join("-");
}
