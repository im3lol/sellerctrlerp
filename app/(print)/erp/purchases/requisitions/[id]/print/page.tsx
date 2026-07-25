import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { materialRequests, materialRequestLines, items, users } from "@/db/schema";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { dt, qty } from "@/lib/erp/print-format";

/** طلب شراء داخلي (طلب مواد) — نسخة الطباعة. */
export default async function RequisitionPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [mr] = await db.select({
      id: materialRequests.id, number: materialRequests.number, date: materialRequests.date, status: materialRequests.status,
      notes: materialRequests.notes, requester: users.name,
    }).from(materialRequests).leftJoin(users, sql`${users.id}::text = ${materialRequests.requestedBy}`)
      .where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, orgId))).limit(1);
    if (!mr) notFound();

    const lines = await db.select({ name: items.nameAr, code: items.code, quantity: materialRequestLines.quantity })
      .from(materialRequestLines).innerJoin(items, eq(items.id, materialRequestLines.itemId))
      .where(eq(materialRequestLines.materialRequestId, id)).orderBy(asc(items.code));

    const { org, hiddenFor, footerText } = await loadPrintHeader(orgId);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("purchase-requisition")}
        footerText={footerText}
        title="طلب شراء"
        number={mr.number}
        meta={[
          { label: "التاريخ", value: dt(mr.date) },
          { label: "مقدم الطلب", value: mr.requester ?? "—" },
          { label: "الحالة", value: mr.status === "APPROVED" ? "معتمد" : "مسودة" },
        ]}
        columns={[
          { label: "#", align: "center", width: "6%" },
          { label: "الصنف" },
          { label: "الكمية", align: "end", width: "16%" },
        ]}
        rows={lines.map((l, i) => [
          i + 1,
          <span key="n"><span style={{ fontFamily: "monospace", fontSize: 10 }}>{l.code}</span> {l.name}</span>,
          qty(l.quantity),
        ])}
        note={mr.notes}
        signatures={["مقدم الطلب", "المعتمد"]}
        watermark={mr.status !== "APPROVED" ? "مسودة" : undefined}
        backHref={`/purchases/requisitions/${mr.id}`}
      />
    );
  });
}
