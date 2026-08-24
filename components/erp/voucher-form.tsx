"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createReceiptVoucherAction } from "@/app/actions/erp/receipts";
import { createPaymentVoucherAction } from "@/app/actions/erp/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Party = { id: string; code: string; name: string };
type OpenInvoice = { id: string; number: string; partyId: string; balanceDue: number };
type Account = { id: string; code: string; name: string };


export function VoucherForm({
  mode,
  parties,
  invoices,
  cashAccounts,
  defaultPartyId,
  defaultInvoiceId,
}: {
  mode: "receipt" | "payment";
  parties: Party[];
  invoices: OpenInvoice[];
  cashAccounts: Account[];
  defaultPartyId?: string;
  defaultInvoiceId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isReceipt = mode === "receipt";

  const [partyId, setPartyId] = useState(defaultPartyId ?? "");
  const [invoiceId, setInvoiceId] = useState(defaultInvoiceId ?? "");
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState(() => {
    const inv = invoices.find((i) => i.id === defaultInvoiceId);
    return inv ? String(inv.balanceDue) : "";
  });
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const partyInvoices = useMemo(
    () => invoices.filter((i) => i.partyId === partyId),
    [invoices, partyId],
  );

  const partyOptions = useMemo(() => parties.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` })), [parties]);
  const partyLabelById = useMemo(() => new Map(partyOptions.map((o) => [o.id, o.label])), [partyOptions]);
  const cashOptions = useMemo(() => cashAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [cashAccounts]);
  const cashLabelById = useMemo(() => new Map(cashOptions.map((o) => [o.id, o.label])), [cashOptions]);

  const pickInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv) setAmount(String(inv.balanceDue));
  };

  const partyLabel = isReceipt ? "العميل" : "المورد";
  const dest = isReceipt ? "/sales/receipts" : "/purchases/payments";

  const submit = () =>
    start(async () => {
      if (!partyId) { toast.error(`اختر ${partyLabel}`); return; }
      if (!cashAccountId) { toast.error("اختر حساب النقدية/البنك"); return; }
      if (!(Number(amount) > 0)) { toast.error("أدخل مبلغاً صحيحاً"); return; }
      const base = { cashAccountId, amount: Number(amount), date, paymentMethod: method, reference, notes };
      const r = isReceipt
        ? await createReceiptVoucherAction({ ...base, customerId: partyId, salesInvoiceId: invoiceId || undefined })
        : await createPaymentVoucherAction({ ...base, supplierId: partyId, purchaseInvoiceId: invoiceId || undefined });
      if (r.ok) {
        toast.success((isReceipt ? "تم حفظ سند القبض" : "تم حفظ سند الصرف") + " (مسودة) — راجِعه ثم أكّده للترحيل");
        // Land ON the voucher, not on the list: «تأكيد» is the next step and it lives
        // on the document. Dropping the user in a list leaves the draft unposted.
        router.push(r.number ? `${dest}/${encodeURIComponent(r.number)}` : dest);
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر الحفظ");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isReceipt ? "سند قبض جديد" : "سند صرف جديد"}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="party">{partyLabel}</Label>
          <CellCombobox
            selectedLabel={partyLabelById.get(partyId) ?? ""}
            options={partyOptions}
            onSelect={(id) => { setPartyId(id); setInvoiceId(""); }}
            placeholder={`ابحث عن ${partyLabel}…`}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invoice">الفاتورة (اختياري)</Label>
          <select id="invoice" className={selectCls} value={invoiceId} onChange={(e) => pickInvoice(e.target.value)} disabled={!partyId}>
            <option value="">— دفعة تحت الحساب —</option>
            {partyInvoices.map((i) => (
              <option key={i.id} value={i.id}>{i.number} (متبقّي {i.balanceDue.toLocaleString("ar-EG-u-nu-latn")})</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">المبلغ</Label>
          <Input id="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cash">حساب النقدية / البنك</Label>
          <CellCombobox
            selectedLabel={cashLabelById.get(cashAccountId) ?? ""}
            options={cashOptions}
            onSelect={(id) => setCashAccountId(id)}
            placeholder={cashAccounts.length === 0 ? "لا توجد حسابات نقدية" : "ابحث عن الحساب…"}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">التاريخ</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="method">طريقة الدفع</Label>
          <select id="method" className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">نقدي</option>
            <option value="BANK">تحويل بنكي</option>
            <option value="CARD">بطاقة</option>
            <option value="CHEQUE">شيك</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ref">المرجع (اختياري)</Label>
          <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم شيك / تحويل" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">ملاحظات</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="sm:col-span-2 flex justify-end">
          <Button disabled={pending} onClick={submit}>{isReceipt ? "تسجيل القبض" : "تسجيل الصرف"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
