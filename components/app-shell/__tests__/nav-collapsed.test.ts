import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The rail is a client component: stub the router hooks it reads so it can render on
// the server. No JSX — vitest only collects `*.test.ts`.
vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory/items",
  useRouter: () => ({ push: () => {} }),
}));

const { NavList } = await import("@/components/app-shell/nav-list");

const props = { role: "system_admin" as const, erpPermissions: ["inventory.view", "inventory.create"], modules: ["inventory"] };
const render = (collapsed: boolean) =>
  renderToStaticMarkup(createElement(NavList, { ...props, collapsed }) as ReactElement);

describe("collapsed sidebar rail", () => {
  it("keeps the same links as the full list, as icons with the label in a tooltip", () => {
    const full = render(false);
    const rail = render(true);
    expect(rail).toContain('href="/inventory/items"');
    expect(rail).toContain('title="الأصناف"');
    // Labels are not printed as text, so the rail stays one icon wide.
    expect(full).toContain(">الأصناف<");
    expect(rail).not.toContain(">الأصناف<");
    // Nothing is lost: every page the full list offers is still one click away.
    const hrefs = (s: string) => [...s.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs(full)) expect(hrefs(rail)).toContain(href);
  });
});
