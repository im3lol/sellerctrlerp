import "server-only";
import { gunzipSync } from "node:zlib";
import { spJson, paced, credKey } from "./client";
import type { Credential } from "../connector";
import type { DateRange } from "../dto";
import { parseSettlementFlatFile, type SettlementTxn } from "@/lib/erp/amazon-settlement";

// Amazon SCHEDULES settlement reports (~every 14 days on disbursement) — they can't
// be requested on demand, so we LIST the already-generated ones and download each.
// GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 is a gzipped TSV in the long amount-
// component format that parseSettlementFlatFile pivots back into SettlementTxn[].
const REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";

type ReportRow = { reportId?: string; processingStatus?: string; reportDocumentId?: string };
type ListResp = { reports?: ReportRow[]; nextToken?: string };
type DocResp = { url?: string; compressionAlgorithm?: string };

/**
 * List + download every DONE settlement report created in `range`, parse each into
 * SettlementTxn[], concatenated. Dedup happens downstream (upsertSettlementTxns), so
 * overlapping windows across runs are safe. Slow/network-heavy — workers only.
 * The Reports API has a very low quota (getReports ~0.0222/s), so every call is
 * paced on a shared "amazon-reports" gate to avoid the "You exceeded your quota"
 * 429s that outlast the client's own backoff.
 */
const REPORTS_GATE_MS = 3000;
// Per-tenant gate: each seller account has its own SP-API reports quota, so pacing
// keys must be per-account or one tenant's pull needlessly blocks another's.
const gp = <T>(cred: Credential, path: string) => paced(`amazon-reports:${credKey(cred)}`, REPORTS_GATE_MS, () => spJson<T>(cred, path));

export async function fetchSettlements(cred: Credential, range: DateRange): Promise<SettlementTxn[]> {
  const params = new URLSearchParams({
    reportTypes: REPORT_TYPE,
    processingStatuses: "DONE",
    createdSince: range.from.toISOString(),
    createdUntil: range.to.toISOString(),
    pageSize: "100",
  });
  if (cred.marketplaceId) params.set("marketplaceIds", cred.marketplaceId);

  const reports: ReportRow[] = [];
  let path = `/reports/2021-06-30/reports?${params.toString()}`;
  for (let page = 0; page < 20; page++) {
    const resp = await gp<ListResp>(cred, path);
    for (const r of resp.reports ?? []) reports.push(r);
    if (!resp.nextToken) break;
    // nextToken supersedes every other query param on the next page.
    path = `/reports/2021-06-30/reports?${new URLSearchParams({ nextToken: resp.nextToken }).toString()}`;
  }

  const out: SettlementTxn[] = [];
  for (const r of reports) {
    if (r.processingStatus !== "DONE" || !r.reportDocumentId) continue;
    const doc = await gp<DocResp>(cred, `/reports/2021-06-30/documents/${r.reportDocumentId}`);
    if (!doc.url) continue;
    const res = await fetch(doc.url, { cache: "no-store", signal: AbortSignal.timeout(120_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    out.push(...parseSettlementFlatFile(text));
  }
  return out;
}
