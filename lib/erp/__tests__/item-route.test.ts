import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: [] as { code: string }[], where: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: (filter: unknown) => {
  mock.where(filter); return { orderBy: () => ({ limit: async () => mock.rows }) };
} }) }) } }));
import { itemCodeParam } from "../item-route";
import { itemHref } from "../item-href";

beforeEach(() => { mock.rows = []; mock.where.mockClear(); });
describe("canonical item routes", () => {
  it("encodes an item code as one URL segment", () => {
    expect(itemHref("P-00001")).toBe("/inventory/items/P-00001");
    expect(itemHref("A/B %25", "/edit")).toBe("/inventory/items/A%2FB%20%2525/edit");
  });
  it("keeps the canonical code without redirecting", async () => {
    mock.rows = [{ code: "P-00001" }];
    await expect(itemCodeParam("P-00001", "org-a")).resolves.toBe("P-00001");
    expect(mock.where).toHaveBeenCalledOnce();
  });
  it("redirects legacy UUID detail and edit bookmarks to the current code", async () => {
    mock.rows = [{ code: "P-00001" }];
    const id = "24f911ae-537a-4519-b905-0c114d3710cc";
    await expect(itemCodeParam(id, "org-a")).rejects.toThrow("redirect:/inventory/items/P-00001");
    await expect(itemCodeParam(id, "org-a", "/edit")).rejects.toThrow("redirect:/inventory/items/P-00001/edit");
  });
  it("does not decode a literal percent sequence twice", async () => {
    mock.rows = [{ code: "A%25" }];
    await expect(itemCodeParam("A%25", "org-a")).resolves.toBe("A%25");
  });
  it("allows an exact code which happens to look like a UUID", async () => {
    const code = "24f911ae-537a-4519-b905-0c114d3710cc";
    mock.rows = [{ code }];
    await expect(itemCodeParam(code, "org-a")).resolves.toBe(code);
  });
  it("never redirects an inaccessible or missing item", async () => {
    await expect(itemCodeParam("24f911ae-537a-4519-b905-0c114d3710cc", "other-org")).rejects.toThrow("not-found");
  });
});
