import "server-only";
import type { Credential } from "../connector";
import type { DateRange } from "../dto";
import { requestAndDownloadReport } from "./reports";
import { parseMfnReturnsReport } from "@/lib/erp/amazon-mfn-returns";
import type { FbaReturnRow } from "@/lib/erp/amazon-returns";

// Seller-fulfilled (MFN/FBM) customer returns, plus the Seller-Fulfilled Prime variant.
// FBA has its own report; between the two, every fulfilment a seller can use is covered.
//
// Amazon Flex is NOT a third case: it is a last-mile delivery programme, so a Flex order
// is still MFN or FBA and its returns arrive in whichever of these two reports owns it.
//
// Both are best-effort. An account with no seller-fulfilled orders gets an empty or
// rejected report, and a returns sync must not fail because a report a seller never uses
// isn't there — so each is caught and contributes nothing.
const MFN = "GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE";
const PRIME = "GET_CSV_MFN_PRIME_RETURNS_REPORT";

async function safeReport(cred: Credential, type: string, range: DateRange): Promise<FbaReturnRow[]> {
  try {
    const text = await requestAndDownloadReport(cred, type, { dataStartTime: range.from, dataEndTime: range.to });
    return parseMfnReturnsReport(text);
  } catch {
    return [];
  }
}

export async function fetchMfnReturns(cred: Credential, range: DateRange): Promise<FbaReturnRow[]> {
  const [mfn, prime] = await Promise.all([safeReport(cred, MFN, range), safeReport(cred, PRIME, range)]);
  // Prime returns can also appear in the general report; key on order+sku+date so the
  // same physical return isn't imported twice.
  const seen = new Set(mfn.map((r) => `${r.orderId}|${r.sku}|${r.returnDate?.toISOString() ?? ""}`));
  return [...mfn, ...prime.filter((r) => !seen.has(`${r.orderId}|${r.sku}|${r.returnDate?.toISOString() ?? ""}`))];
}
