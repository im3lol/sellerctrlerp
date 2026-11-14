"use client";
import { normalizeLabelLayout, LABEL_LAYOUT_KEY, type LabelPrintLayout } from "./label-layout";
import { buildLabelBatchDocument, type LabelJob } from "@/lib/erp/label-batch";

/** One print document and one native dialog for the entire batch; no local agent. */
export function printLabelBatch(jobs: LabelJob[], preferences?:Partial<LabelPrintLayout>): Promise<void> {
  let layout=normalizeLabelLayout(preferences);
  if(!preferences){try{layout=normalizeLabelLayout(JSON.parse(localStorage.getItem(LABEL_LAYOUT_KEY)||"{}"));}catch{/* Storage may be disabled. */}}
  const html = buildLabelBatchDocument(jobs,layout);
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "SellerCtrl label print batch";
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: `${layout.width}mm`, height: `${layout.height}mm`, border: "0" });
    let printed = false;
    const cleanup = () => frame.remove();
    const timeout = window.setTimeout(cleanup, 300000);
    frame.onload = () => {
      if (printed) return;
      printed = true;
      const target = frame.contentWindow;
      if (!target) { cleanup(); window.clearTimeout(timeout); reject(new Error("تعذّر فتح نافذة الطباعة")); return; }
      target.addEventListener("afterprint", () => { cleanup(); window.clearTimeout(timeout); }, { once: true });
      try { target.focus(); target.print(); resolve(); }
      catch { cleanup(); window.clearTimeout(timeout); reject(new Error("تعذّر فتح نافذة الطباعة")); }
    };
    frame.onerror = () => { cleanup(); window.clearTimeout(timeout); reject(new Error("تعذّر فتح نافذة الطباعة")); };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}
