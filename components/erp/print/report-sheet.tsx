import type { ReactNode } from "react";
import { PrintNowButton } from "@/components/erp/print-now-button";
import type { PrintOrg, PrintColumn } from "@/components/erp/print/document-sheet";

/**
 * The printed REPORT — DocumentSheet's sibling, same identity (palette, A4,
 * letterhead, navy table headers, per-page thead, footer), shaped for reports:
 * a filters summary instead of parties, a compact KPI strip instead of cards,
 * and one-or-many table sections instead of a single line-items table.
 * Charts are deliberately dropped from print.
 */

const T = {
  primary: "#1f2937",
  ink: "#1e2433",
  muted: "#8a93a6",
  body: "#5b6478",
  line: "#e8ecf3",
  danger: "#d64545",
  success: "#1f9d63",
};

export type ReportKpi = { label: string; value: string; tone?: "danger" | "success" };
export type ReportSection = {
  title?: string;
  columns: PrintColumn[];
  rows: ReactNode[][];
  /** Bold totals row pinned under the section's table. */
  footerRow?: ReactNode[];
};

export type ReportSheetProps = {
  org: PrintOrg | undefined;
  title: string;
  /** e.g. "من 1 يناير 2026 إلى 25 يوليو 2026" */
  period?: string;
  /** The active filters, so the printout is self-describing. */
  filters?: { label: string; value: string }[];
  kpis?: ReportKpi[];
  sections: ReportSection[];
  /** e.g. truncation notice "عُرضت أول 3000 صف من 12404". */
  note?: string | null;
  backHref: string;
};

const initials = (name: string | null | undefined) =>
  (name ?? "؟").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

export function ReportSheet({ org, title, period, filters = [], kpis = [], sections, note, backHref }: ReportSheetProps) {
  const printedAt = new Date().toLocaleString("ar-EG-u-nu-latn", { dateStyle: "long", timeStyle: "short" });
  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

        .doc { max-width: 800px; margin: 0 auto; padding: 32px; color: ${T.ink}; }

        .doc table { border-collapse: collapse; width: 100%; }
        .doc thead { display: table-header-group; }
        .doc tr { break-inside: avoid; page-break-inside: avoid; }
        .doc th {
          background: ${T.primary}; color: #fff; padding: 8px 10px;
          font-size: 10px; font-weight: 700; letter-spacing: .3px;
        }
        .doc th:first-child { border-start-start-radius: 6px; }
        .doc th:last-child  { border-start-end-radius: 6px; }
        .doc td { padding: 8px 10px; border-bottom: 1px solid ${T.line}; font-size: 10.5px; }
        .doc tfoot td { font-weight: 800; border-top: 1.5px solid ${T.primary}; border-bottom: none; font-size: 11px; }

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

      <div className="doc">
        {/* ── letterhead ── */}
        <div className="mb-6 flex items-start justify-between gap-6">
          <div className="flex items-start gap-3.5">
            {org?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo} alt="" width={50} height={50}
                style={{ borderRadius: 10, objectFit: "contain", border: "1px solid #eef1f7" }} />
            ) : (
              <div style={{
                width: 50, height: 50, borderRadius: 10, background: T.primary, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18,
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
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: ".5px", color: T.primary }}>{title}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: T.muted, lineHeight: 1.8 }}>
              {period && <div>{period}</div>}
              <div>طُبع في <b style={{ color: T.ink }}>{printedAt}</b></div>
              {filters.map((f) => (
                <div key={f.label}>{f.label}: <b style={{ color: T.ink }}>{f.value}</b></div>
              ))}
            </div>
          </div>
        </div>

        {/* ── KPI strip ── */}
        {kpis.length > 0 && (
          <div className="mb-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)` }}>
            {kpis.map((k) => (
              <div key={k.label} style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 9.5, color: T.muted }}>{k.label}</div>
                <div style={{
                  fontSize: 14, fontWeight: 800, marginTop: 2,
                  color: k.tone === "danger" ? T.danger : k.tone === "success" ? T.success : T.ink,
                }}>{k.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── sections ── */}
        {sections.map((s, si) => (
          <div key={si} style={{ marginBottom: 22 }}>
            {s.title && (
              <div style={{ fontSize: 13, fontWeight: 800, color: T.primary, margin: "0 0 8px" }}>{s.title}</div>
            )}
            <table>
              <thead>
                <tr>
                  {s.columns.map((c) => (
                    <th key={c.label} style={{ textAlign: c.align ?? "start", width: c.width }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td key={j} style={{ textAlign: s.columns[j]?.align ?? "start" }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {s.footerRow && (
                <tfoot>
                  <tr>
                    {s.footerRow.map((cell, j) => (
                      <td key={j} style={{ textAlign: s.columns[j]?.align ?? "start" }}>{cell}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ))}

        {note && (
          <div style={{ marginTop: 8, fontSize: 10.5, color: T.body }}>{note}</div>
        )}

        <div style={{ marginTop: 28, paddingTop: 12, borderTop: `1px solid ${T.line}`, textAlign: "center", fontSize: 10, color: T.muted }}>
          {[org?.nameAr, org?.phone, org?.taxNumber && `الرقم الضريبي: ${org.taxNumber}`].filter(Boolean).join(" · ")}
        </div>
      </div>
    </>
  );
}
