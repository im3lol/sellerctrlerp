"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createExpenseAction, updateExpenseAction } from "@/app/actions/erp/expenses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Account = { id: string; code: string; name: string };
export type ExpenseInitial = { id: string; expenseAccountId: string; cashAccountId: string; amount: string; date: string; method: string; payee: string; reference: string; notes: string };

export function ExpenseForm({ expenseAccounts, cashAccounts, initial }: { expenseAccounts: Account[]; cashAccounts: Account[]; initial?: ExpenseInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!initial?.id;

  const [expenseAccountId, setExpenseAccountId] = useState(initial?.expenseAccountId ?? "");
  const [cashAccountId, setCashAccountId] = useState(initial?.cashAccountId ?? cashAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [method, setMethod] = useState(initial?.method ?? "CASH");
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const expOptions = useMemo(() => expenseAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [expenseAccounts]);
  const expLabelById = useMemo(() => new Map(expOptions.map((o) => [o.id, o.label])), [expOptions]);
  const cashOptions = useMemo(() => cashAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [cashAccounts]);
  const cashLabelById = useMemo(() => new Map(cashOptions.map((o) => [o.id, o.label])), [cashOptions]);

  const submit = () =>
    start(async () => {
      if (!expenseAccountId) { toast.error("اختر بند المصروف"); return; }
      if (!cashAccountId) { toast.error("اختر حساب النقدية/البنك"); return; }
      if (!(Number(amount) > 0)) { toast.error("أدخل مبلغاً صحيحاً"); return; }
      const body = { expenseAccountId, cashAccountId, amount: Number(amount), date, paymentMethod: method, payee, reference, notes };
      const r = isEdit ? await updateExpenseAction(initial!.id, body) : await createExpenseAction(body);
      if (r.ok) {
        toast.success(isEdit ? "تم حفظ التعديلات" : "تم حفظ المصروف (مسودة) — أكّده للترحيل");
        router.push("/accounting/expenses");
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر الحفظ");
      }
    });

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>بند المصروف</Label>
          <CellCombobox
            selectedLabel={expLabelById.get(expenseAccountId) ?? ""}
            options={expOptions}
            onSelect={(id) => setExpenseAccountId(id)}
            placeholder={expenseAccounts.length === 0 ? "لا توجد حسابات مصروفات" : "ابحث عن بند المصروف…"}
          />
        </div>

        <div className="space-y-2">
          <Label>المبلغ</Label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>الدفع من (نقدية / بنك)</Label>
          <CellCombobox
            selectedLabel={cashLabelById.get(cashAccountId) ?? ""}
            options={cashOptions}
            onSelect={(id) => setCashAccountId(id)}
            placeholder={cashAccounts.length === 0 ? "لا توجد حسابات نقدية" : "ابحث عن الحساب…"}
          />
        </div>

        <div className="space-y-2">
          <Label>التاريخ</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>طريقة الدفع</Label>
          <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">نقدي</option>
            <option value="BANK">تحويل بنكي</option>
            <option value="CARD">بطاقة</option>
            <option value="CHEQUE">شيك</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label>المستفيد (اختياري)</Label>
          <Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="لمن صُرف المبلغ" />
        </div>

        <div className="space-y-2">
          <Label>المرجع (اختياري)</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم شيك / تحويل / فاتورة" />
        </div>

        <div className="space-y-2">
          <Label>ملاحظات</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end sm:col-span-2">
          <Button disabled={pending} onClick={submit}>{isEdit ? "حفظ التعديلات" : "تسجيل المصروف"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
