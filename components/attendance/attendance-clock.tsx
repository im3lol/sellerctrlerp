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
import { Button } from "@/components/ui/button";
import type { AttendanceSnapshot } from "@/lib/attendance";
import { cn } from "@/lib/utils";

const R = 88;
const CIRC = 2 * Math.PI * R;
// Full ring fills over an 8-hour target day.
const TARGET = 8 * 3600;

export function AttendanceClock({ initial }: { initial: AttendanceSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const seconds = useWorkTimer(snap);
  const progress = Math.min(1, seconds / TARGET);
  const onBreak = snap.status === "break";
  const working = snap.status === "working";

  useEffect(() => {
    setSnap(initial);
  }, [initial.status, initial.clockInAt, initial.currentBreakStart, initial.breakSeconds]);

  const run = (fn: () => Promise<AttendanceSnapshot>) =>
    start(async () => {
      setSnap(await fn());
      router.refresh();
    });

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative grid place-items-center">
        <svg width="200" height="200" className="-rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={onBreak ? "hsl(var(--warning))" : "hsl(var(--primary))"}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="font-mono text-3xl font-bold tabular-nums" dir="ltr">
            {formatHMS(seconds)}
          </span>
          <span className="mt-1 text-sm text-muted-foreground">
            {snap.status === "out" ? "خارج الدوام" : onBreak ? "في استراحة" : "يعمل الآن"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {snap.status === "out" ? (
          <Button size="lg" className="bg-success text-white hover:bg-success/90" onClick={() => run(clockInAction)} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            بدء العمل
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              variant="outline"
              className={cn(onBreak && "border-warning text-warning")}
              onClick={() => run(onBreak ? endBreakAction : startBreakAction)}
              disabled={pending}
            >
              <Coffee className="size-4" />
              {onBreak ? "إنهاء الاستراحة" : "استراحة"}
            </Button>
            <Button size="lg" variant="destructive" onClick={() => run(clockOutAction)} disabled={pending || !working && !onBreak}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              إنهاء العمل
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
