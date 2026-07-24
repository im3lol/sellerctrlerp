"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const HIDE_KEY = "sc_setup_card_hidden";

/** Dashboard nudge while essential setup is incomplete. Hidden per-browser via
 *  localStorage; disappears on its own once the checklist derives 100%. */
export function SetupProgressCard({ done, total }: { done: number; total: number }) {
  const [hidden, setHidden] = useState(true); // start hidden to avoid a flash, reveal after the localStorage read
  useEffect(() => { setHidden(localStorage.getItem(HIDE_KEY) === "1"); }, []);
  if (hidden) return null;
  const pct = Math.round((done / total) * 100);

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <Rocket className="size-6 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">أكمل إعداد حسابك — {done} من {total}</div>
          <div className="mt-1.5 h-2 max-w-xs overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Button asChild size="sm"><Link href="/setup">متابعة الإعداد</Link></Button>
        <Button size="icon" variant="ghost" aria-label="إخفاء" onClick={() => { localStorage.setItem(HIDE_KEY, "1"); setHidden(true); }}>
          <X className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
