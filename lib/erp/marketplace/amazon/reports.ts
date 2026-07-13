import "server-only";
import { gunzipSync } from "zlib";
import { spJson } from "./client";
import type { Credential } from "../connector";
import type { DateRange } from "../dto";

// SP-API Reports 2021-06-30 flow: create a report → poll until DONE → fetch the
// document (decompress if gzipped). Report types we use (flat files that match
// the manual-upload parsers we already have):
export const REPORT_TYPE = {
  ORDERS: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
  FBA_INVENTORY_LEDGER: "GET_LEDGER_DETAIL_VIEW_DATA",
  LISTINGS: "GET_MERCHANT_LISTINGS_ALL_DATA",
} as const;

const RP = "/reports/2021-06-30";

type CreateResp = { reportId: string };
type StatusResp = { processingStatus: string; reportDocumentId?: string };
type DocResp = { url: string; compressionAlgorithm?: string };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Request a report and return its downloaded bytes (decompressed). Polls up to
 * ~2.5 min; throws if the report is cancelled/fatal or never completes. The
 * caller feeds the bytes to the matching parser.
 */
export async function requestReport(cred: Credential, reportType: string, range: DateRange): Promise<Buffer> {
  if (!cred.marketplaceId) throw new Error("لا يوجد معرّف سوق (marketplace) للاتصال");

  const created = await spJson<CreateResp>(cred, `${RP}/reports`, {
    method: "POST",
    body: JSON.stringify({
      reportType,
      marketplaceIds: [cred.marketplaceId],
      dataStartTime: range.from.toISOString(),
      dataEndTime: range.to.toISOString(),
    }),
  });

  // Poll for completion (SP-API reports are async).
  let documentId: string | undefined;
  for (let i = 0; i < 30; i++) {
    await sleep(i === 0 ? 3000 : 5000);
    const st = await spJson<StatusResp>(cred, `${RP}/reports/${created.reportId}`);
    if (st.processingStatus === "DONE") { documentId = st.reportDocumentId; break; }
    if (st.processingStatus === "CANCELLED") throw new Error("ألغت أمازون التقرير (لا بيانات في الفترة غالبًا)");
    if (st.processingStatus === "FATAL") throw new Error("فشل توليد التقرير لدى أمازون (FATAL)");
  }
  if (!documentId) throw new Error("انتهت مهلة انتظار التقرير من أمازون");

  const doc = await spJson<DocResp>(cred, `${RP}/documents/${documentId}`);
  const res = await fetch(doc.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`تعذّر تنزيل مستند التقرير (${res.status})`);
  const raw = Buffer.from(await res.arrayBuffer());
  return doc.compressionAlgorithm === "GZIP" ? gunzipSync(raw) : raw;
}
