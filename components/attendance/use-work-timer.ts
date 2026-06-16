"use client";

import { useEffect, useState } from "react";
import type { AttendanceSnapshot } from "@/lib/attendance";

/** Live-ticking worked-seconds derived from a snapshot. */
export function useWorkTimer(snap: AttendanceSnapshot): number {
  const compute = () => {
    if (snap.status === "out" || !snap.clockInAt) return 0;
    const now = Date.now();
    const clockIn = new Date(snap.clockInAt).getTime();
    const gross = Math.floor((now - clockIn) / 1000);
    const openBreak = snap.currentBreakStart
      ? Math.floor((now - new Date(snap.currentBreakStart).getTime()) / 1000)
      : 0;
    return Math.max(0, gross - snap.breakSeconds - openBreak);
  };

  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    if (snap.status === "working") {
      const id = setInterval(() => setSeconds(compute()), 1000);
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.status, snap.clockInAt, snap.breakSeconds, snap.currentBreakStart]);

  return seconds;
}
