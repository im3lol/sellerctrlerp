"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { clockAction, getMyClockAction } from "@/app/actions/erp/attendance";
import { formatDuration } from "@/lib/erp/attendance";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/**
 * The employee's own check-in / check-out. Shows the running total while the day is
 * open, because a button that only says "clock out" gives no reason to trust what it
 * recorded.
 */
export function ClockButton() {
  const [state, setState] = useState<"IN" | "OUT" | "NONE" | null>(null);
  const [linked, setLinked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pending, start] = useTransition();

  const refresh = () =>
    void getMyClockAction().then((r) => { setLinked(r.linked); setState(r.state); setSeconds(r.seconds); });

  useEffect(() => { refresh(); }, []);

  // Tick the visible total while the shift is open, so it reads as live rather than stale.
  useEffect(() => {
    if (state !== "IN") return;
    const id = setInterval(() => setSeconds((s) => s + 60), 60_000);
    return () => clearInterval(id);
  }, [state]);

  if (state === null || !linked) return null;

  const go = (direction: "IN" | "OUT") =>
    start(async () => {
      const r = await clockAction(direction);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التسجيل"); return; }
      toast.success(direction === "IN" ? "تم تسجيل الحضور" : `تم تسجيل الانصراف — ${formatDuration(r.seconds ?? 0)}`);
      refresh();
    });

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-lg border p-3">
      <div className="text-sm text-muted-foreground">
        {state === "IN" ? "أنت مسجّل حضور" : state === "OUT" ? "انتهى يومك" : "لسه مسجّلتش حضور النهارده"}
      </div>
      {(state === "IN" || state === "OUT") && (
        <div className="font-mono text-2xl font-bold tabular-nums" dir="ltr">{formatDuration(seconds)}</div>
      )}
      {state === "IN" ? (
        <Button variant="outline" className="w-full" disabled={pending} onClick={() => go("OUT")}>
          <Icon name="LogOut" className="size-4" />تسجيل انصراف
        </Button>
      ) : (
        <Button className="w-full" disabled={pending} onClick={() => go("IN")}>
          <Icon name="LogIn" className="size-4" />تسجيل حضور
        </Button>
      )}
    </div>
  );
}
