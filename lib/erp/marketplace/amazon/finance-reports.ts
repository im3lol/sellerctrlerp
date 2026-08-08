import "server-only";
import type { Credential } from "../connector";
import type { DateRange } from "../dto";
import { requestAndDownloadReport } from "./reports";
import { parseReimbursementsReport, type FbaReimbursementRow } from "@/lib/erp/amazon-reimbursements";
import { parseLedgerReport, type FbaLedgerRow } from "@/lib/erp/amazon-ledger";
import { parseRemovalsReport, type RemovalRow } from "@/lib/erp/amazon-removals";

// FBA finance/history report pulls (request → poll → download via the shared
// paced Reports helper). Both are read-only feeds.

export async function fetchReimbursements(cred: Credential, range: DateRange): Promise<FbaReimbursementRow[]> {
  const text = await requestAndDownloadReport(cred, "GET_FBA_REIMBURSEMENTS_DATA", { dataStartTime: range.from, dataEndTime: range.to });
  return parseReimbursementsReport(text);
}

export async function fetchLedgerEvents(cred: Credential, range: DateRange): Promise<FbaLedgerRow[]> {
  const text = await requestAndDownloadReport(cred, "GET_LEDGER_DETAIL_VIEW_DATA", { dataStartTime: range.from, dataEndTime: range.to });
  return parseLedgerReport(text);
}

export async function fetchRemovals(cred: Credential, range: DateRange): Promise<RemovalRow[]> {
  const text = await requestAndDownloadReport(cred, "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA", { dataStartTime: range.from, dataEndTime: range.to });
  return parseRemovalsReport(text);
}
