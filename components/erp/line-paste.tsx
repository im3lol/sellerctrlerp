"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { toast } from "@/lib/i18n/toast";
import { clipboardCells, type PasteColumn } from "@/lib/erp/clipboard-grid";
import { resolvePasteItemsAction, type PasteItem } from "@/app/actions/erp/item-search";

export type LinePaste = { paste: (row: number, column: string, text: string) => void; busy: boolean; revision: number };
export function useLinePaste<T>({ rows, setRows, columns, newRow, apply, prepare, context = "" }: {
  rows: T[]; setRows: (rows: T[]) => void; columns: PasteColumn[]; newRow: () => T;
  apply: (row: T, values: Record<string, string | number>, item?: PasteItem) => T;
  prepare?: (rows: T[], changed: number[]) => Promise<T[]>;
  context?: string;
}): LinePaste {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const latest = useRef(rows);
  const currentContext = useRef(context);
  // Track committed inputs before events/async completions can apply a paste.
  useLayoutEffect(() => { latest.current = rows; currentContext.current = context; }, [rows, context]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return { busy, revision, paste: async (start, column, text) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const snapshot = rows;
    try {
      const cells = clipboardCells(text, columns, column);
      if (!cells.length) return;
      const codes = [...new Set(cells.flatMap(v => typeof v.itemId === "string" ? [v.itemId] : []))];
      const resolved = codes.length ? await resolvePasteItemsAction(codes) : [];
      const next = [...snapshot], changed: number[] = [];
      for (let i = 0; i < cells.length; i++) {
        const values = cells[i];
        if (!Object.keys(values).length) continue;
        const code = values.itemId;
        const match = typeof code === "string" ? resolved.find(r => r.code === code) : undefined;
        if (match && !match.item) throw new Error(fill(t(match.ambiguous ? "الصف {0}: الكود {1} مرتبط بأكثر من صنف" : "الصف {0}: الكود {1} غير موجود"), [i + 1, code]));
        while (next.length <= start + i) next.push(newRow());
        next[start + i] = apply({ ...next[start + i] }, values, match?.item);
        changed.push(start + i);
      }
      const ready = prepare ? await prepare(next, changed) : next;
      // A late server response must never overwrite typing, deletion or row reordering.
      if (!mounted.current) return;
      if (latest.current !== snapshot || currentContext.current !== context) throw new Error("اتغير الجدول أثناء اللصق؛ الصق البيانات مرة أخرى");
      setRows(ready);
      setRevision(n => n + 1);
      toast.success(fill(t("تم لصق {0} صف"), [changed.length]), { action: { label: t("تراجع"), onClick: () => {
        if (mounted.current && latest.current === ready && currentContext.current === context) setRows(snapshot);
        else toast.error(t("اتغير الجدول بعد اللصق؛ لا يمكن التراجع تلقائيًا"));
      } } });
    } catch (e) { toast.error(t(e instanceof Error ? e.message : "تعذّر اللصق")); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  } };
}

export function LinePasteHint({ busy = false }: { busy?: boolean }) {
  const t = useT();
  return <p className="text-xs text-muted-foreground" role="status">{t(busy ? "جارٍ التحقق من البيانات…" : "الصق من Excel في أول خلية للأكواد أو الكميات أو الأسعار (حتى 300 صف). الأعمدة تتبع ترتيب حقول الإدخال، مع تجاهل الوحدة والمستودع والقيم المحسوبة. الخلايا الفارغة لا تغيّر القيم الحالية.")}</p>;
}
