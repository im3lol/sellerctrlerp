import "server-only";
import { spJson, paced, credKey } from "./client";
import { marketplaceById } from "./constants";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "../connector";

// Product Fees API v0: estimated referral + FBA fulfillment fees per SKU at a
// given price. Batch endpoint takes up to 20 requests per call (~0.5/s).

export type FeeEstimate = {
  sku: string;
  currency?: string;
  referralFee: number;
  fbaFee: number;
  totalFees: number;
  raw: unknown;
};

type FeeDetail = { FeeType?: string; FinalFee?: { CurrencyCode?: string; Amount?: number } };
type BatchItem = {
  Status?: string;
  FeesEstimateIdentifier?: { IdValue?: string };
  FeesEstimate?: { TotalFeesEstimate?: { CurrencyCode?: string; Amount?: number }; FeeDetailList?: FeeDetail[] };
};
type BatchResp = { payload?: BatchItem[] };

/** Pure: one batch-response item → FeeEstimate (null when Amazon returned no estimate). */
export function parseFeeItem(item: BatchItem): FeeEstimate | null {
  const sku = item.FeesEstimateIdentifier?.IdValue;
  if (!sku || item.Status !== "Success" || !item.FeesEstimate) return null;
  let referral = 0, fba = 0;
  for (const d of item.FeesEstimate.FeeDetailList ?? []) {
    const amt = Number(d.FinalFee?.Amount) || 0;
    if (d.FeeType === "ReferralFee") referral += amt;
    else if (d.FeeType === "FBAFees" || d.FeeType === "FulfillmentFees" || d.FeeType === "FBAPerUnitFulfillmentFee") fba += amt;
  }
  return {
    sku,
    currency: item.FeesEstimate.TotalFeesEstimate?.CurrencyCode,
    referralFee: round2(referral),
    fbaFee: round2(fba),
    totalFees: round2(Number(item.FeesEstimate.TotalFeesEstimate?.Amount) || 0),
    raw: item,
  };
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Fetch fee estimates for SKUs at their prices (batched 20/call, paced ~0.5/s). */
export async function fetchFeesEstimates(cred: Credential, skus: { sku: string; price: number }[]): Promise<FeeEstimate[]> {
  if (!cred.marketplaceId) return [];
  const currency = marketplaceById(cred.marketplaceId)?.currency ?? "USD";
  const out: FeeEstimate[] = [];
  for (const batch of chunk(skus.filter((s) => s.sku && s.price > 0), 20)) {
    const body = {
      FeesEstimateByIdRequestList: batch.map((s) => ({
        IdType: "SellerSKU",
        IdValue: s.sku,
        FeesEstimateRequest: {
          MarketplaceId: cred.marketplaceId,
          IsAmazonFulfilled: true,
          Identifier: s.sku,
          PriceToEstimateFees: { ListingPrice: { CurrencyCode: currency, Amount: s.price } },
        },
      })),
    };
    try {
      const resp = await paced(`amazon-fees:${credKey(cred)}`, 2100, () =>
        spJson<BatchResp>(cred, `/products/fees/v0/feesEstimate`, { method: "POST", body: JSON.stringify(body) }));
      for (const item of resp.payload ?? []) {
        const fe = parseFeeItem(item);
        if (fe) out.push(fe);
      }
    } catch {
      // A failed batch shouldn't abort the whole refresh; skip it.
    }
  }
  return out;
}
