"use client";

import { useState, useTransition } from "react";
import { respondQuotationAction } from "@/app/actions/public/doc-response";

/** The customer's answer to a quotation — once. After that the page just says what they chose. */
export function QuoteResponse({ token, status }: { token: string; status: string }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [answered, setAnswered] = useState<string | null>(status === "ACCEPTED" || status === "REJECTED" ? status : null);
  const [error, setError] = useState<string | null>(null);

  if (answered) {
    return (
      <p className="font-medium">
        {answered === "ACCEPTED" ? "✅ تم تسجيل موافقتك على العرض — هنتواصل معاك قريب." : "تم تسجيل ردّك: العرض مرفوض. شكراً لوقتك."}
      </p>
    );
  }

  const send = (decision: "ACCEPTED" | "REJECTED") => start(async () => {
    setError(null);
    const r = await respondQuotationAction(token, decision, name);
    if (r.ok) setAnswered(decision);
    else setError(r.error ?? "حصل خطأ — جرّب تاني");
  });

  return (
    <div className="space-y-3">
      <div className="font-bold">رأيك في العرض؟</div>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="اسمك (اختياري)"
        className="w-full max-w-xs rounded-md border px-3 py-2" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => send("ACCEPTED")}
          className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          موافق على العرض
        </button>
        <button type="button" disabled={pending} onClick={() => send("REJECTED")}
          className="rounded-md border px-4 py-2 font-medium hover:bg-muted disabled:opacity-50">
          مش موافق
        </button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
