"use client";

import { code128Svg } from "@/lib/code128";

export type LabelRow = { itemName: string; barcode: string; itemCode: string };

/** Printable 50×25mm barcode label sheet (one label per array entry). Client so
 *  the print/back toolbar buttons actually work. Shared by the per-document and
 *  ad-hoc batch label pages. */
export function BarcodeLabelSheet({ labels, title }: { labels: LabelRow[]; title: string }) {
  return (
    <>
      <style>{`
        @page { size: 50mm 25mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: white; }
        .label { width: 50mm; height: 25mm; padding: 1mm 1.5mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; page-break-after: always; background: white; }
        .label:last-child { page-break-after: avoid; }
        .item-name { font-family: 'Segoe UI', 'Noto Sans Arabic', sans-serif; font-size: 6pt; line-height: 1.2; max-height: 6mm; overflow: hidden; text-align: right; direction: rtl; color: #000; word-break: break-word; }
        .barcode-wrap { flex: 1; display: flex; align-items: center; padding: 0.5mm 0; }
        .barcode-wrap svg { width: 100%; height: 11mm; display: block; }
        .item-footer { display: flex; justify-content: space-between; align-items: center; font-family: monospace; font-size: 5pt; color: #444; direction: ltr; }
        .toolbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; font-family: 'Segoe UI', sans-serif; font-size: 13px; }
        .toolbar button { padding: 6px 16px; border: none; border-radius: 4px; background: #0d6efd; color: white; font-size: 13px; cursor: pointer; font-family: inherit; }
        .toolbar button:hover { background: #0b5ed7; }
        .toolbar .back { background: transparent; border: 1px solid #ccc; color: #333; }
        .toolbar .back:hover { background: #e9ecef; }
        .toolbar .info { color: #555; margin-right: auto; }
        @media print { .toolbar { display: none !important; } }
        @media screen { body { padding-top: 52px; background: #e9ecef; } .label { margin: 8px auto; border: 1px solid #ccc; box-shadow: 0 1px 4px rgba(0,0,0,.15); } }
      `}</style>

      <div className="toolbar">
        <button onClick={() => window.print()}>🖨 طباعة / حفظ PDF</button>
        <button className="back" onClick={() => window.history.back()}>رجوع</button>
        <span className="info">{title} — {labels.length} ملصق</span>
      </div>

      {labels.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", fontFamily: "sans-serif", color: "#888" }}>لا توجد بنود بباركود.</div>
      ) : (
        labels.map((label, i) => (
          <div key={i} className="label">
            <div className="item-name">{label.itemName}</div>
            <div className="barcode-wrap" dangerouslySetInnerHTML={{ __html: code128Svg(label.barcode, 32, false) }} />
            <div className="item-footer"><span>{label.barcode}</span><span>{label.itemCode}</span></div>
          </div>
        ))
      )}
    </>
  );
}
