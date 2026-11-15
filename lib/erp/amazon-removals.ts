// Pure parser for Amazon's FBA removal-order detail report
// (GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA): a header-keyed TSV, one row per
// removal line. A removal takes stock OUT of the FBA warehouse — either shipped back to
// the seller (Return) or destroyed by Amazon (Disposal). NOT a customer return, so it
// never reverses revenue: shipped units restock, disposed units are written off. No I/O
// here — vitest-friendly, mirrors amazon-returns.ts.

export type RemovalRow = {
  requestDate: Date | null;
  removalOrderId: string;
  orderType: string;   // Return | Disposal
  orderStatus: string; // Pending | Completed | Cancelled | ...
  sku: string;
  fnsku: string;
  disposition: string; // Sellable | Unsellable | Defective | ...
  requestedQty: number;
  cancelledQty: number;
  disposedQty: number; // Amazon destroyed these
  shippedQty: number;  // Amazon shipped these back to the seller
  pendingQty?:number;
  shipments?:RemovalShipment[];
};
export type RemovalShipment={removalOrderId:string;sku:string;fnsku:string;disposition:string;shipmentDate:string|null;shippedQty:number;carrier:string;trackingNumber:string};
export function parseRemovalShipmentsReport(tsv:string):RemovalShipment[]{
 const lines=tsv.split(/\r?\n/).filter(Boolean);if(lines.length<2)return [];
 const headers=lines[0].split("\t").map(h=>h.trim().toLowerCase());
 if(!["order-id","sku","shipped-quantity"].every(h=>headers.includes(h)))throw new Error("Invalid removal shipment report headers");
 return lines.slice(1).map(line=>{const c=line.split("\t"),get=(h:string)=>(c[headers.indexOf(h)]??"").trim();
  const raw=get("shipment-date"),date=raw?new Date(raw):null,qty=Number(get("shipped-quantity"));
  if(!get("order-id")||!get("sku")||!Number.isFinite(qty)||qty<0)throw new Error("Invalid removal shipment row");
  return {removalOrderId:get("order-id"),sku:get("sku"),fnsku:get("fnsku"),disposition:get("disposition"),shipmentDate:date&&Number.isFinite(date.getTime())?date.toISOString():null,shippedQty:qty,carrier:get("carrier"),trackingNumber:get("tracking-number")};
 });
}

export function parseRemovalsReport(tsv: string): RemovalRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("request-date"), iOrder = idx("order-id"), iType = idx("order-type"),
    iStatus = idx("order-status"), iSku = idx("sku"), iFnsku = idx("fnsku"),
    iDisp = idx("disposition"), iReq = idx("requested-quantity"), iCancel = idx("cancelled-quantity"),
    iDisposed = idx("disposed-quantity"), iShipped = idx("shipped-quantity");
  if (iOrder < 0 || iSku < 0) return [];

  const cell = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  const num = (c: string[], i: number) => Number(cell(c, i).replace(/,/g, "")) || 0;
  const out: RemovalRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const removalOrderId = cell(c, iOrder);
    const sku = cell(c, iSku);
    if (!removalOrderId || !sku) continue;
    const rawDate = cell(c, iDate);
    const d = rawDate ? new Date(rawDate) : null;
    out.push({
      requestDate: d && !Number.isNaN(d.getTime()) ? d : null,
      removalOrderId, orderType: cell(c, iType), orderStatus: cell(c, iStatus),
      sku, fnsku: cell(c, iFnsku), disposition: cell(c, iDisp),
      requestedQty: num(c, iReq), cancelledQty: num(c, iCancel),
      disposedQty: num(c, iDisposed), shippedQty: num(c, iShipped),
      pendingQty:num(c,idx("in-process-quantity")),
    });
  }
  return out;
}

/** Stable idempotency key: one line per (removal order, sku, disposition). Re-pulling an
 *  overlapping window dedups; quantities refresh on the upsert. */
export function removalDedupKey(r: RemovalRow): string {
  return [r.removalOrderId, r.sku, r.disposition].join("|");
}
