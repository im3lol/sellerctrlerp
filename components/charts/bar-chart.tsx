"use client";

import { useT } from "@/lib/i18n/client";
import { chartAxisNumber, shortChartLabel } from "./axis-format";
import { Bar, BarChart as RBarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell } from "recharts";

// Reusable single-series bar chart for ordered distributions (aging buckets, top-N).
// One hue by default; pass `colors` for a categorical set (validated palette).
const arInt = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn");
const arMoney = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BarChart({
  data,
  valueLabel = "القيمة",
  money = false,
  height = 240,
  colors,
}: {
  data: { label: string; value: number }[];
  valueLabel?: string;
  money?: boolean;
  height?: number;
  colors?: string[];
}) {
  const t = useT();
  const fmt = money ? arMoney : arInt;
  const hideLabels = data.some((d) => Array.from(t(d.label)).length > 24);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }} style={{ direction: "ltr" }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis hide={hideLabels} dataKey="label" tickFormatter={(v) => shortChartLabel(t(String(v)), 14)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis width={72} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => chartAxisNumber(Number(v))} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12, maxWidth: 320, whiteSpace: "normal", overflowWrap: "anywhere" }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          labelFormatter={(l) => t(String(l))}
          formatter={(v) => [fmt(Number(v)), t(valueLabel)]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} fill="hsl(var(--primary))">
          {colors && data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}
