/**
 * Web scraping & automation (axiom.ai-style) shared helpers.
 *
 * Flow: the Edge extension captures CSS selectors interactively and saves a
 * "recipe". A scrape job snapshots the recipe + the target draft products. The
 * Dockerised Playwright worker polls `/api/scrape/worker/next`, opens each
 * product URL, extracts each field via its selector, and posts results back.
 * Scraped values only FILL MISSING fields — never overwrite existing data — and
 * the product stays a draft until a reviewer confirms it.
 */

import { timingSafeEqual } from "node:crypto";
import type { productBases } from "@/db/schema";

/** Product columns that can be populated by scraping (key = recipe field). */
export const SCRAPE_FIELDS = [
  { key: "name", labelAr: "اسم المنتج", attr: "text" },
  { key: "brand", labelAr: "البراند", attr: "text" },
  { key: "price", labelAr: "السعر", attr: "text" },
  { key: "imageUrl", labelAr: "صورة العرض", attr: "src" },
  { key: "description", labelAr: "الوصف", attr: "text" },
  { key: "features", labelAr: "المميزات", attr: "text" },
  { key: "sizes", labelAr: "المقاسات", attr: "text" },
  { key: "colors", labelAr: "الألوان", attr: "text" },
] as const;

export type ScrapeFieldKey = (typeof SCRAPE_FIELDS)[number]["key"];
export type RecipeFields = Record<string, { selector: string; attr: string }>;

const FIELD_KEYS = new Set(SCRAPE_FIELDS.map((f) => f.key));

/** Keep only known field keys with a non-empty selector. */
export function sanitizeFields(input: unknown): RecipeFields {
  const out: RecipeFields = {};
  if (input && typeof input === "object") {
    for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
      if (!FIELD_KEYS.has(key as ScrapeFieldKey)) continue;
      const o = v as { selector?: unknown; attr?: unknown };
      const selector = typeof o?.selector === "string" ? o.selector.trim() : "";
      if (!selector) continue;
      const attr = typeof o?.attr === "string" && o.attr ? o.attr : "text";
      out[key] = { selector, attr };
    }
  }
  return out;
}

type BaseRow = typeof productBases.$inferSelect;

/**
 * Given a product's base catalog row and the values a worker scraped, compute
 * the base-column updates — only for fields currently empty. `price` is
 * normalised to digits/decimal. Returns null when nothing new can be filled.
 */
export function buildScrapeUpdate(
  base: BaseRow,
  data: Record<string, string>,
  overwrite = false,
): Partial<Record<ScrapeFieldKey, string>> | null {
  const update: Record<string, string> = {};
  for (const { key } of SCRAPE_FIELDS) {
    const raw = data[key];
    if (typeof raw !== "string") continue;
    const value = key === "price" ? raw.replace(/[^\d.]/g, "") : raw.trim();
    if (!value) continue;
    // By default don't overwrite existing data; "re-scrape all" mode overwrites.
    if (!overwrite && base[key as keyof BaseRow]) continue;
    update[key] = value;
  }
  return Object.keys(update).length ? update : null;
}

/**
 * SQL-ish predicate (as Drizzle conditions are built by callers): a draft is
 * "incomplete" when it still lacks a core scraped field (image or price).
 * Centralised here so worker + UI agree on what "needs scraping" means.
 */
export const INCOMPLETE_FIELDS = ["imageUrl", "price"] as const;

/** True for a canonical UUID — guards DB queries from malformed input (else Postgres 500s). */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Bearer-token auth for worker + extension endpoints. Constant-time compare. */
export function scraperTokenOk(req: Request): boolean {
  const token = process.env.SCRAPER_TOKEN;
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!provided || provided.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch {
    return false;
  }
}

/** Permissive CORS for token-authenticated endpoints (the Edge extension). */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
