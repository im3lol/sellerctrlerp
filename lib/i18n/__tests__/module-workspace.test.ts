import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translator } from "@/lib/i18n";
import { NAV } from "@/components/app-shell/nav-config";
import { ModuleWorkspace } from "@/components/erp/module-workspace";

vi.mock("@/lib/i18n/server", async () => {
  const { translator } = await import("@/lib/i18n");
  return { getT: async () => translator("en") };
});

// Resolve nested server components before React's synchronous HTML renderer.
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const component = element.type as (props: { children?: ReactNode }) => Promise<ReactNode>;
    const resolved = await resolve(await component(element.props));
    return isValidElement(resolved) ? cloneElement(resolved, { key: element.key }) : resolved;
  }
  const children = await resolve(element.props.children);
  return Array.isArray(children) ? cloneElement(element, {}, ...children) : cloneElement(element, {}, children);
}

describe("English module workspaces", () => {
  const escaped = (source: string) => renderToStaticMarkup(createElement("span", null, translator("en")(source))).replace(/^<span>|<\/span>$/g, "");
  const modules = NAV.filter(s => s.heading && s.items.some(i => i.capability?.startsWith("erp.")));
  it.each(modules)("keeps the $heading workspace and translates its groups and tiles", async section => {
    const permissions = section.items.map(i => i.capability?.replace(/^erp\./, "") ?? "");
    const tree = await ModuleWorkspace({ heading: section.heading!, permissions });
    expect(tree).not.toBeNull();
    const html = renderToStaticMarkup(await resolve(tree));
    for (const item of section.items) expect(html).toContain(escaped(item.label));
    for (const group of new Set(section.items.map(i => i.group).filter(Boolean))) {
      expect(html).toContain(escaped(group!));
    }
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("respects a restricted member's permissions in English", async () => {
    const tree = await ModuleWorkspace({ heading: "المبيعات", permissions: ["sales.view"] });
    const html = renderToStaticMarkup(await resolve(tree));
    expect(html).toContain('href="/sales/orders"');
    expect(html).not.toContain('href="/sales/pos"');
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
  });
});
