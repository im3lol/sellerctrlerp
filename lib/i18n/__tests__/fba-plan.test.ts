import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FbaPlanTable } from "@/components/erp/fba-plan-table";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar" }));
vi.mock("@/lib/i18n/client", async () => {
  const { translator } = await import("@/lib/i18n");
  return { useT: () => translator(state.locale), useLocale: () => state.locale };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/actions/erp/stock-transfers", () => ({ createStockTransferAction: vi.fn() }));

function render(sourceName: string) {
  return renderToStaticMarkup(createElement(FbaPlanTable, {
    rows: [], sourceName, fromWarehouseId: "source", toWarehouseId: "amazon", windowDays: 30, canCreate: true,
  }));
}
describe("FBA plan warehouse labels", () => {
  it("translates the default warehouse in headings, summaries and tooltips", () => {
    state.locale = "en";
    const html = render("المستودع الرئيسي");
    expect(html).toContain("Main warehouse");
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("preserves a custom warehouse name", () => {
    state.locale = "en";
    expect(render("مخزن فريقنا الخاص")).toContain("مخزن فريقنا الخاص");
  });
  it("preserves the Arabic interface", () => {
    state.locale = "ar";
    expect(render("المستودع الرئيسي")).toContain("المستودع الرئيسي");
  });
});
