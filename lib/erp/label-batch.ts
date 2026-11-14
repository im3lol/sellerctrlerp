import { normalizeLabelLayout, type LabelPrintLayout } from "./label-layout";
import { code128Svg } from "@/lib/code128";

export type LabelJob = { itemName: string; value: string };
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildLabelBatchDocument(jobs: LabelJob[], settings?:Partial<LabelPrintLayout>) {
  if (!jobs.length) throw new Error("لا توجد ملصقات للطباعة");
  if (jobs.length > 5000) throw new Error("الحد الأقصى للدفعة 5000 ملصق؛ قسّم الكمية على دفعات");
  const layout=normalizeLabelLayout(settings);
  const barcodes = new Map<string, string>();
  const labels = jobs.map(job => {
    if (!job.value || job.value.length > 256 || !/^[\x20-\x7e]+$/.test(job.value)) throw new Error("الكود غير صالح لباركود CODE128؛ اختر كودًا آخر للصنف");
    if (!barcodes.has(job.value)) barcodes.set(job.value, code128Svg(job.value, 40, false));
    return `<section class="label"><div class="content"><div class="name" dir="auto">${escape(job.itemName)}</div>${barcodes.get(job.value)}<div class="code">${escape(job.value)}</div></div></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>SellerCtrl Labels</title><style>
@page{size:${layout.width}mm ${layout.height}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif}
.label{width:${layout.width}mm;height:${layout.height}mm;padding:1.5mm 5mm;overflow:hidden;break-inside:avoid;break-after:page;page-break-after:always}.content{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8mm;transform:translate(${layout.offsetX}mm,${layout.offsetY}mm)}
.label:last-child{break-after:auto;page-break-after:auto}.name{font-size:6pt;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}.label svg{display:block;width:100%;height:${Math.min(12,layout.height*0.4)}mm!important}.code{font:7.5pt monospace;letter-spacing:.3px;direction:ltr;white-space:nowrap}
</style></head><body data-label-count="${jobs.length}">${labels}</body></html>`;
}
