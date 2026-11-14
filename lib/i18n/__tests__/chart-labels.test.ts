import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translator } from "@/lib/i18n";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatusDonut } from "@/components/charts/status-donut";

vi.mock("@/lib/i18n/client", async () => {
  const { translator } = await import("@/lib/i18n");
  return { useT: () => translator("en") };
});
vi.mock("recharts", () => {
  const container = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  const empty = () => null;
  return {
    ResponsiveContainer: container, BarChart: container,
    AreaChart: ({ children }: { children?: ReactNode }) => createElement("svg", null, children),
    PieChart: container, Pie: container, Bar: empty, Area: empty, Cell: empty,
    XAxis: empty, YAxis: empty, CartesianGrid: empty,
    Tooltip: ({ formatter }: { formatter: (value: number, name: string) => unknown[] }) =>
      createElement("span", null, String(formatter(5, "مسودة")[1])),
  };
});

describe("English chart tooltips", () => {
  it.each([BarChart, TrendChart])("translates default and report-supplied value labels", (Chart) => {
    const data = [{ label: "يناير", value: 5 }];
    const t = translator("en");
    expect(renderToStaticMarkup(createElement(Chart, { data }))).toContain(t("القيمة"));
    expect(renderToStaticMarkup(createElement(Chart, { data, valueLabel: "المبيعات" }))).toContain(t("المبيعات"));
    expect(renderToStaticMarkup(createElement(Chart, { data, valueLabel: "المبيعات" }))).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("translates donut hover labels as well as its visible legend", () => {
    const html = renderToStaticMarkup(createElement(StatusDonut, { data: [{ name: "مسودة", value: 5, color: "blue" }] }));
    expect(html).toContain(translator("en")("مسودة"));
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
  });
});
