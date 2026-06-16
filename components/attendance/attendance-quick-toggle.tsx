"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Coffee, Loader2 } from "lucide-react";
import {
  clockInAction,
  clockOutAction,
  startBreakAction,
  endBreakAction,
} from "@/app/actions/attendance";
import { useWorkTimer } from "@/components/attendance/use-work-timer";
import { formatHMS } from "@/components/attendance/format";
import type { AttendanceSnapshot } from "@/lib/attendance";
import { cn } from "@/lib/utils";

export function AttendanceQuickToggle({ initial }: { initial: AttendanceSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [pending, startTransition] = useTransition();
  const seconds = useWorkTimer(snap);
  const router = useRouter();

  // Keep in sync with server-provided state (e.g. after revalidation).
  useEffect(() => {
    setSnap(initial);
  }, [initial.status, initial.clockInAt, initial.currentBreakStart, initial.breakSeconds]);

  const run = (fn: () => Promise<AttendanceSnapshot>) =>
    startTransition(async () => {
      setSnap(await fn());
      router.refresh();
    });

  if (snap.status === "out") {
    return (
      <button
        onClick={() => run(clockInAction)}
        disabled={pending}
        className="flex items-center gap-2 rounded-full bg-success px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        بدء العمل
      </button>
    );
  }

  const onBreak = snap.status === "break";

  return (
    <div className="flex items-center gap-1.5 rounded-full border bg-card py-1 pr-3 pl-1">
      <span
        className={cn(
          "size-2 rounded-full",
          onBreak ? "bg-warning" : "animate-pulse bg-success",
        )}
      />
      <span className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
        {formatHMS(seconds)}
      </span>
      <button
        onClick={() => run(onBreak ? endBreakAction : startBreakAction)}
        disabled={pending}
        title={onBreak ? "إنهاء الاستراحة" : "بدء استراحة"}
        className="grid size-8 place-items-center rounded-full text-warning transition hover:bg-warning/10 disabled:opacity-60"
      >
        <Coffee className="size-4" />
      </button>
      <button
        onClick={() => run(clockOutAction)}
        disabled={pending}
        title="إنهاء العمل"
        className="grid size-8 place-items-center rounded-full bg-destructive/10 text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
      </button>
    </div>
  );
}
