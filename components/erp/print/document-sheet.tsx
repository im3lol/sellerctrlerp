import type { ReactNode } from "react";
import { PrintNowButton } from "@/components/erp/print-now-button";

/**
 * The printed document — one sheet, every document type.
 *
 * Design ported from the InvoiceOS invoice paper (E:\Dev\inovicebulider): navy table
 * header, yellow Balance Due chip, red discount. Two deliberate departures from the
 * source:
 *
 *  1. A real <table>, not the source's CSS grid. The source has no break-inside rule,
 *     so a long invoice slices rows in half at the page boundary and loses the column
 *     headers on page 2. A table repeats <thead> per page and keeps rows whole.
 *  2. The brand font (Thmanyah, from the root layout) instead of Manrope — Manrope has
 *     no Arabic glyphs. The old print pages hardcoded `body { font-family: 'Segoe UI' }`,
 *     which beat the `font-sans` class by specificity, so documents printed in a
 *     different typeface than the rest of the product. Not reproducing that.
 *
 * Mirrored for RTL: logo + company on the right, document title/number on the left,
 * totals block on the left.
 */

/** The source's palette (lib/templateTypes.ts:179 + InvoicePaper.tsx). */
const T = {
  primary: "#1f2937",   // table header, doc title, total
  accent: "#fde68a",    // balance chip
  accentText: "#7a5a00",
  ink: "#1e2433",
  muted: "#8a93a6",
  body: "#5b6478",
  line: "#e8ecf3",
  danger: "#d64545",    // discount
  success: "#1f9d63",   // paid
};

export type PrintOrg = {
  nameAr: string | null;
  address?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
  logo?: string | null;
  /** Print settings turned the logo off — render nothing, not the initials tile. */
  noLogo?: boolean;
};

export type PrintColumn = {
  label: string;
  align?: "start" | "center" | "end";
  /** CSS width, e.g. "8%". Omit to let the table share it out. */
  width?: string;
};

export type PrintTotal = {
  label: string;
  value: string;
  tone?: "danger" | "success" | "strong";
};

export type PrintParty = {
  label: string;
  name: string;
  lines: (string | null | undefined)[];
};

export type DocumentSheetProps = {
  org: PrintOrg | undefined;
  /** e.g. "فاتورة بيع" */
  title: string;
  number: string;
  /** Date, due date, status… rendered under the number. */
  meta?: { label: string; value: string }[];
  /** One or two parties (customer / ship-to). */
  parties?: PrintParty[];
  columns?: PrintColumn[];
  rows?: ReactNode[][];
  totals?: PrintTotal[];
  /** The highlighted chip — the one number the reader is looking for. */
  balance?: { label: string; value: string };
  note?: string | null;
  signatures?: string[];
  /** Diagonal faded stamp across the sheet — pass "مسودة" for unposted documents. */
  watermark?: string;
  /** Column labels to drop (org print settings) — filters columns AND row cells by index. */
  hiddenColumns?: string[];
  /** Org print settings: extra line above the footer (thanks / terms). */
  footerText?: string;
  /** Where the «رجوع» button goes. */
  backHref: string;
};

const initials = (name: string | null | undefined) =>
  (name ?? "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

export function DocumentSheet({
  org, title, number, meta = [], parties = [], columns: allColumns = [], rows: allRows = [],
  totals = [], balance, note, signatures = [], watermark, hiddenColumns = [], footerText, backHref,
}: DocumentSheetProps) {
  const visible = allColumns.map((c, i) => (hiddenColumns.includes(c.label) ? -1 : i)).filter((i) => i >= 0);
  const columns = visible.map((i) => allColumns[i]);
  const rows = visible.length === allColumns.length ? allRows : allRows.map((r) => visible.map((i) => r[i]));
  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm; }

        /* Without this the browser drops the navy header and the yellow chip — they
           print as white and the document loses its structure. Load-bearing. */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

        .doc { max-width: 800px; margin: 0 auto; padding: 32px; color: ${T.ink}; }
        .doc-muted { color: ${T.muted}; }

        .doc table { border-collapse: collapse; width: 100%; }
        /* Repeat the column headers on every printed page. */
        .doc thead { display: table-header-group; }
        .doc tr { break-inside: avoid; page-break-inside: avoid; }
        .doc th {
          background: ${T.primary}; color: #fff; padding: 10px 12px;
          font-size: 10.5px; font-weight: 700; letter-spacing: .3px;
        }
        .doc th:first-child { border-start-start-radius: 6px; }
        .doc th:last-child  { border-start-end-radius: 6px; }
        .doc td { padding: 11px 12px; border-bottom: 1px solid ${T.line}; font-size: 11.5px; }

        /* On screen the toolbar floats over the top-start corner — push the sheet
           clear of it. Removed for print, where the toolbar is hidden. */
        @media screen { .doc { margin-top: 56px; } }

        @media print {
          .no-print { display: none !important; }
          .doc { padding: 0; max-width: none; margin-top: 0; }
        }
      `}</style>

      <div className="no-print fixed top-4 start-4 z-50 flex gap-2">
        <PrintNowButton />
        <a href={backHref} className="rounded border bg-white px-4 py-2 text-sm font-medium shadow hover:bg-muted">
          رجوع
        </a>
      </div>

      <div className="doc" style={{ position: "relative" }}>
        {watermark && (
          <div aria-hidden style={{
            position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: 0,
          }}>
            <span style={{
              transform: "rotate(-30deg)", fontSize: 110, fontWeight: 800,
              color: T.muted, opacity: 0.12, letterSpacing: "8px", whiteSpace: "nowrap",
            }}>{watermark}</span>
          </div>
        )}
        {/* ── header: who we are (right) · what this is (left) ── */}
        <div className="mb-7 flex items-start justify-between gap-6">
          <div className="flex items-start gap-3.5">
            {org?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo} alt="" width={50} height={50}
                style={{ borderRadius: 10, objectFit: "contain", border: "1px solid #eef1f7" }} />
            ) : org?.noLogo ? null : (
              // No logo uploaded — an initials tile keeps the header from looking broken.
              <div style={{
                width: 50, height: 50, borderRadius: 10, background: T.primary, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 18,
              }}>{initials(org?.nameAr)}</div>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{org?.nameAr}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 3, lineHeight: 1.5 }}>
                {org?.address && <div>{org.address}</div>}
                {org?.phone && <div dir="ltr" style={{ textAlign: "start" }}>{org.phone}</div>}
                {org?.taxNumber && <div>الرقم الضريبي: <span dir="ltr">{org.taxNumber}</span></div>}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "end" }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".5px", color: T.primary }}>{title}</div>
            <div style={{ marginTop: 8, fontSize: 11, color: T.muted, lineHeight: 1.8 }}>
              <div>رقم المستند <b style={{ color: T.ink }} dir="ltr">{number}</b></div>
              {meta.map((m) => (
                <div key={m.label}>{m.label} <b style={{ color: T.ink }}>{m.value}</b></div>
              ))}
            </div>
          </div>
        </div>

        {/* ── parties ── */}
        {parties.length > 0 && (
          <div className="mb-6 grid gap-8" style={{ gridTemplateColumns: `repeat(${parties.length}, 1fr)` }}>
            {parties.map((p) => (
              <div key={p.label}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1px", color: T.muted }}>{p.label}</div>
                <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: T.body, marginTop: 4, lineHeight: 1.6 }}>
                  {p.lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── lines ── */}
        {columns.length > 0 && (
          <table className="mb-6">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label} style={{ textAlign: c.align ?? "start", width: c.width }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} style={{ textAlign: columns[j]?.align ?? "start" }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── totals ── */}
        {(totals.length > 0 || balance) && (
          <div className="flex justify-start">
            <div style={{ width: 270 }}>
              {totals.map((t) => (
                <div key={t.label} className="flex justify-between" style={{
                  padding: "5px 0",
                  fontSize: t.tone === "strong" ? 14 : 12,
                  fontWeight: t.tone === "strong" ? 800 : 500,
                  borderTop: t.tone === "strong" ? `1px solid ${T.line}` : undefined,
                  marginTop: t.tone === "strong" ? 4 : undefined,
                }}>
                  <span style={{ color: t.tone === "strong" ? T.ink : T.muted }}>{t.label}</span>
                  <span style={{
                    fontWeight: t.tone === "strong" ? 800 : 700,
                    color: t.tone === "danger" ? T.danger
                      : t.tone === "success" ? T.success
                      : t.tone === "strong" ? T.primary : T.ink,
                  }}>{t.value}</span>
                </div>
              ))}
              {balance && (
                <div className="flex justify-between" style={{
                  marginTop: 8, padding: "9px 12px", borderRadius: 6,
                  background: T.accent, color: T.accentText, fontSize: 12.5, fontWeight: 800,
                }}>
                  <span>{balance.label}</span><span>{balance.value}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {note && (
          <div style={{ marginTop: 24, fontSize: 12, color: T.body, lineHeight: 1.7 }}>{note}</div>
        )}

        {signatures.length > 0 && (
          <div className="mt-12 grid gap-8" style={{ gridTemplateColumns: `repeat(${signatures.length}, 1fr)` }}>
            {signatures.map((s) => (
              <div key={s} style={{ textAlign: "center" }}>
                <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 6, fontSize: 11, color: T.muted }}>{s}</div>
              </div>
            ))}
          </div>
        )}

        {footerText && (
          <div style={{ marginTop: 28, textAlign: "center", fontSize: 11, color: T.body, lineHeight: 1.7 }}>{footerText}</div>
        )}
        <div style={{ marginTop: footerText ? 12 : 32, paddingTop: 12, borderTop: `1px solid ${T.line}`, textAlign: "center", fontSize: 10, color: T.muted }}>
          {[org?.nameAr, org?.phone, org?.taxNumber && `الرقم الضريبي: ${org.taxNumber}`].filter(Boolean).join(" · ")}
        </div>
      </div>
    </>
  );
}
