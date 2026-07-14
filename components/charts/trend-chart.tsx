"use client";

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
  const fmt = money ? arMoney : arInt;
  const gid = `trendFill-${id}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis width={52} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmt(Number(v))} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12 }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v) => [fmt(Number(v)), valueLabel]}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
