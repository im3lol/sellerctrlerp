"use client";

import { Bar, BarChart as RBarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from "recharts";

// Two-series grouped bars for period comparisons (revenue vs expense per month).
// Teal/amber is a CVD-safe categorical pair; a legend names both series.
const arMoney = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function GroupedBarChart({
  data,
  series,
  height = 260,
}: {
  data: { label: string; [k: string]: number | string }[];
  series: { key: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => arMoney(Number(v))} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", fontSize: 12 }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v, name) => [arMoney(Number(v)), name as string]}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} radius={[4, 4, 0, 0]} maxBarSize={40} fill={s.color} isAnimationActive={false} />
        ))}
      </RBarChart>
    </ResponsiveContainer>
  );
}
