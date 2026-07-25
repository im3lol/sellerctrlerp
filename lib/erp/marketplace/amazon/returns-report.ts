import "server-only";
import type { Credential } from "../connector";
import type { DateRange } from "../dto";
import { requestAndDownloadReport } from "./reports";
import { parseReturnsReport, type FbaReturnRow } from "@/lib/erp/amazon-returns";

// FBA customer-returns pull: request → poll → download the returns report for the
// window, parsed into neutral rows. FBA-only (MFN returns can join later behind the
// same table if an MFN seller shows up).
const REPORT_TYPE = "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA";

export async function fetchFbaReturns(cred: Credential, range: DateRange): Promise<FbaReturnRow[]> {
  const text = await requestAndDownloadReport(cred, REPORT_TYPE, { dataStartTime: range.from, dataEndTime: range.to });
  return parseReturnsReport(text);
}
