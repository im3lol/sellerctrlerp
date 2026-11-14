/** Persisted, versioned case state. Source evidence is held separately and never
 * rewritten by a receipt decision. All quantities/amounts are decimal strings. */
export type WorkflowMode = "MONITOR" | "MANUAL" | "DISABLED";
export type Fulfillment = "FBA" | "MFN" | "UNKNOWN";
export type MoneyParts = { principal: string; discount: string; tax: string; shipping: string };
export type ReturnCaseLine = {
  id: string; itemId: string; invoiceId: string; invoiceLineId: string;
  deliveryId: string | null; soldQuantity: string; expectedQuantity: string | null;
  receivedQuantity: string; waivedQuantity: string; writtenOffQuantity: string;
};
export type ReturnClaim = {
  id: string; lineId: string | null; reference: string | null; reason: string;
  state: "REVIEW" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "RECONCILED" | "CLOSED";
  expectedAmount: string | null; acceptedAmount: string | null;
  currency: string; evidence: string; decisionReason?: string;
  expectedQuantity?: string | null;
  reconciledCash?: string;
  reconciledQuantity?: string;
};
export type ReturnTransfer={id:string;itemId:string;fromWarehouseId:string;transitWarehouseId:string;destinationWarehouseId:string;
  dispatched:string;received:string;lost:string;value:string;sourceId:string};
export type ReturnCaseState = {
  schemaVersion: 1; fulfillment: Fulfillment; matched: boolean;
  invoiceIds: string[]; lines: ReturnCaseLine[]; claims: ReturnClaim[];
  financial: "PENDING" | "PARTIAL" | "POSTED" | "EXEMPT";
  fees: "PENDING" | "RECONCILED" | "EXEMPT";
  financialReason?: string; feeReason?: string;
  exception: string | null;
  transfers?: ReturnTransfer[];
  inventoryExemptReason?: string;
  disposals?:{sourceId:string;quantity:string;expectedQuantity:string}[];
  sourceInventoryPending?:boolean;
  evidenceIds?:string[];
  lossMovementIds?:string[];
};
export const emptyCaseState = (fulfillment: Fulfillment = "UNKNOWN"): ReturnCaseState => ({
  schemaVersion: 1, fulfillment, matched: false, invoiceIds: [], lines: [], claims: [],
  financial: "PENDING", fees: "PENDING", exception: null,
});
export type ReturnOperationKind = "MATCH" | "FINANCIAL" | "RECEIPT" | "TRANSFER" | "WRITE_OFF"
  | "WAIVE_RETURN" | "CLAIM" | "REIMBURSEMENT" | "FEES" | "EXCEPTION" | "REOPEN" | "REVERSE";
export type ReturnSourceKind = "REFUND" | "RETURN" | "LEDGER" | "REMOVAL" | "REIMBURSEMENT";
export type ReturnSource = {
  kind: ReturnSourceKind; sourceId: string; sourceVersion: string; happenedAt: string | null;
  sourceStatus: string | null; currency: string | null; quantity: string | null;
  payload: Record<string, unknown>;
};

/** Fixed-scale arithmetic, without binary floating point or an implicit quantity=1. */
export function scaled(value: string, places = 4): bigint {
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(value)) throw new Error("Invalid decimal");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[-+]/, "").split(".");
  if (fraction.slice(places).replace(/0/g, "")) throw new Error("Decimal precision exceeded");
  return (negative ? -BigInt(1) : BigInt(1)) * BigInt(whole + fraction.padEnd(places, "0").slice(0, places));
}
export function decimal(value: bigint, places = 4): string {
  const n = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${n / BigInt(10) ** BigInt(places)}.${(n % BigInt(10) ** BigInt(places)).toString().padStart(places, "0")}`;
}
export function refundAmount(parts: MoneyParts): string {
  const values = Object.values(parts).map(v => scaled(v));
  if (values.some(v => v < BigInt(0))) throw new Error("Refund components must be nonnegative");
  if(scaled(parts.discount)>scaled(parts.principal))throw new Error("Discount exceeds principal");
  const net = scaled(parts.principal) - scaled(parts.discount) + scaled(parts.tax) + scaled(parts.shipping);
  if (net <= BigInt(0)) throw new Error("Refund must be positive");
  return decimal(net);
}
export function caseClosure(state: ReturnCaseState) {
  const financialClosed = state.financial === "POSTED" || state.financial === "EXEMPT";
  const feesClosed = state.fees !== "PENDING";
  const linesClosed = state.lines.length > 0 && state.lines.every(l => {
    if (l.expectedQuantity === null) return false;
    const expected = scaled(l.expectedQuantity), received = scaled(l.receivedQuantity), waived = scaled(l.waivedQuantity);
    return expected >= BigInt(0) && received >= BigInt(0) && waived >= BigInt(0) && received + waived === expected;
  });
  const transfersClosed=(state.transfers??[]).every(tr=>scaled(tr.received)+scaled(tr.lost)===scaled(tr.dispatched));
  const disposalsClosed=(state.disposals??[]).every(d=>scaled(d.quantity)===scaled(d.expectedQuantity));
  const inventoryClosed=state.matched && (linesClosed || (!!state.inventoryExemptReason && !state.lines.length) ||
    (!state.lines.length && (!!state.transfers?.length||!!state.disposals?.length))) && transfersClosed && disposalsClosed && !state.sourceInventoryPending;
  const claimsClosed = state.claims.every(c => ["RECONCILED", "CLOSED"].includes(c.state));
  return { financialClosed, inventoryClosed, feesClosed, claimsClosed,
    closed: state.matched && financialClosed && inventoryClosed && feesClosed && claimsClosed && !state.exception };
}
export function assertReceiptCapacity(line: ReturnCaseLine, quantity: string) {
  const q = scaled(quantity);
  if (q <= BigInt(0) || line.expectedQuantity === null ||
      q + scaled(line.receivedQuantity) + scaled(line.waivedQuantity) > scaled(line.expectedQuantity)) {
    throw new Error("Receipt exceeds the unresolved return quantity");
  }
}
