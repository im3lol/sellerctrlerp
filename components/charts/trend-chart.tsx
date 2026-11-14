"use client";

import { useT } from "@/lib/i18n/client";
import { chartAxisNumber, shortChartLabel } from "./axis-format";
import { Area, AreaChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";

// Reusable single-series time trend (area+line). Themed via CSS vars so it tracks
// light/dark. One hue only (primary) — the title names the series, so no legend.
const arInt = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn");
const arMoney = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TrendChart({
  data,
  valueLabel = "القيمة",
  money = false,
  height = 240,
  id = "trend",
}: {
  data: { label: string; value: number }[];
  valueLabel?: string;
  money?: boolean;
  height?: number;
  /** Unique gradient id when more than one TrendChart renders on a page. */
  id?: string;
}) {
  const t = useT();
  const fmt = money ? arMoney : arInt;
  const gid = `trendFill-${id}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart style={{ direction: "ltr" }} data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tickFormatter={(v) => shortChartLabel(t(String(v)), 14)} tickLine={false} axisLine={false} minTickGap={24} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis width={72} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => chartAxisNumber(Number(v))} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12, maxWidth: 320, whiteSpace: "normal", overflowWrap: "anywhere" }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          labelFormatter={(l) => t(String(l))}
          formatter={(v) => [fmt(Number(v)), t(valueLabel)]}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
