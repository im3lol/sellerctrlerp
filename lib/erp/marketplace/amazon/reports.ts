import "server-only";
import { gunzipSync } from "node:zlib";
import { spJson } from "./client";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "../connector";
import type { MarketplaceProduct } from "../dto";

// Full-catalog import via the Reports API (2021-06-30). GET_MERCHANT_LISTINGS_ALL_DATA
// is the ONLY complete enumeration of a seller's listings — no 1000-result cap (unlike
// searchListingsItems), includes FBM + zero-stock, and is one report request for the
// whole catalog (the rate-limit-friendly, Amazon-sanctioned bulk path). Async: request
// → poll → download a gzipped TSV → parse.

const REPORT_TYPE = "GET_MERCHANT_LISTINGS_ALL_DATA";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CreateResp = { reportId?: string };
type StatusResp = { processingStatus?: string; reportDocumentId?: string };
type DocResp = { url?: string; compressionAlgorithm?: string };

/**
 * Parse the tab-separated merchant-listings flat file → products. Columns are keyed
 * by header name (order is not guaranteed across marketplaces). Rows without a
 * seller-sku are skipped.
 */
export function parseListingsReport(tsv: string): MarketplaceProduct[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iSku = idx("seller-sku"), iAsin = idx("asin1"), iName = idx("item-name"), iPrice = idx("price");
  if (iSku < 0) return [];
  const out: MarketplaceProduct[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const code = (c[iSku] ?? "").trim();
    if (!code) continue;
    const altCode = iAsin >= 0 ? ((c[iAsin] ?? "").trim() || undefined) : undefined;
    const name = ((iName >= 0 ? c[iName] : "") ?? "").trim() || code;
    const price = iPrice >= 0 ? round2(Number(c[iPrice]) || 0) : 0;
    out.push({ code, altCode, name, sellPrice: price });
  }
  return out;
}

/**
 * Request → poll → download → parse the full merchant-listings report. Runs for
 * minutes (report generation is async) — call it from a background worker, never a
 * request. `pollMs`/`maxPolls` bound the wait (default ~15 min).
 */
export async function fetchFullListings(cred: Credential, pollMs = 5000, maxPolls = 180): Promise<MarketplaceProduct[]> {
  if (!cred.marketplaceId) return [];

  // 1) Request the report.
  const created = await spJson<CreateResp>(cred, `/reports/2021-06-30/reports`, {
    method: "POST",
    body: JSON.stringify({ reportType: REPORT_TYPE, marketplaceIds: [cred.marketplaceId] }),
  });
  if (!created.reportId) throw new Error("تعذّر إنشاء تقرير أمازون");

  // 2) Poll until DONE (or FATAL/CANCELLED).
  let docId: string | undefined;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollMs);
    const st = await spJson<StatusResp>(cred, `/reports/2021-06-30/reports/${created.reportId}`);
    if (st.processingStatus === "DONE") { docId = st.reportDocumentId; break; }
    if (st.processingStatus === "FATAL" || st.processingStatus === "CANCELLED") {
      throw new Error(`فشل تقرير أمازون (${st.processingStatus})`);
    }
  }
  if (!docId) throw new Error("انتهت مهلة انتظار تقرير أمازون");

  // 3) Resolve the document URL (S3 — fetched directly, NOT via the SP-API host/token).
  const doc = await spJson<DocResp>(cred, `/reports/2021-06-30/documents/${docId}`);
  if (!doc.url) throw new Error("تعذّر تنزيل مستند التقرير");
  const res = await fetch(doc.url, { cache: "no-store", signal: AbortSignal.timeout(120_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  // ponytail: assume UTF-8. Some legacy flat files are cp1252 — if Arabic item names
  // come garbled, decode via TextDecoder('windows-1252') here.
  const text = doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return parseListingsReport(text);
}
