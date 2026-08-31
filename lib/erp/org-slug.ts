import "server-only";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";

// Company names here are almost always Arabic (this UI is Arabic-only — see
// base-currency-egp memory), so a name-derived ASCII slug usually isn't possible.
// A short random slug is still a big readability win over the raw UUID in admin URLs.
const asciiSlug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const shortRandom = (): string => randomBytes(5).toString("hex"); // 10 lowercase hex chars

/** A short, URL-safe, unique org identifier — prefers an ASCII-slugified nameEn,
 *  falls back to a short random string when the name has no latin characters. */
export async function generateOrgSlug(nameEn: string): Promise<string> {
  const base = asciiSlug(nameEn) || shortRandom();
  for (const candidate of [base, ...Array.from({ length: 5 }, () => `${base}-${shortRandom().slice(0, 4)}`)]) {
    const [hit] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate)).limit(1);
    if (!hit) return candidate;
  }
  return shortRandom(); // practically unreachable, but never loop forever
}
