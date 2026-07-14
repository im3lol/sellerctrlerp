"use client";

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
  const fmt = money ? arMoney : arInt;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis width={52} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmt(Number(v))} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12 }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v) => [fmt(Number(v)), valueLabel]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} fill="hsl(var(--primary))">
          {colors && data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}
