import { describe, it, expect } from "vitest";
import { orderMove } from "@/lib/erp/kanban-moves";

describe("orderMove", () => {
  it("sales: confirm, send back to draft, invoice, cancel", () => {
    expect(orderMove("sales", "DRAFT", "CONFIRMED")).toBe("confirm");
    expect(orderMove("sales", "CONFIRMED", "DRAFT")).toBe("revert");
    expect(orderMove("sales", "CONFIRMED", "INVOICED")).toBe("invoice");
    expect(orderMove("sales", "DRAFT", "CANCELLED")).toBe("cancel");
    expect(orderMove("sales", "CONFIRMED", "CANCELLED")).toBe("cancel");
  });

  it("purchase: confirm, back to draft, cancel — invoicing comes from a receipt", () => {
    expect(orderMove("purchase", "DRAFT", "CONFIRMED")).toBe("confirm");
    expect(orderMove("purchase", "CONFIRMED", "DRAFT")).toBe("revert");
    expect(orderMove("purchase", "CONFIRMED", "CANCELLED")).toBe("cancel");
    expect(orderMove("purchase", "CONFIRMED", "INVOICED")).toBeNull();
  });

  it("statuses an order reaches by itself are never a drop target", () => {
    expect(orderMove("sales", "CONFIRMED", "DELIVERED")).toBeNull();
    expect(orderMove("sales", "PARTIALLY_DELIVERED", "CANCELLED")).toBeNull();
    expect(orderMove("purchase", "CONFIRMED", "RECEIVED")).toBeNull();
  });

  it("nothing moves back out of invoiced or cancelled, and a drop in place does nothing", () => {
    expect(orderMove("sales", "INVOICED", "CONFIRMED")).toBeNull();
    expect(orderMove("purchase", "CANCELLED", "DRAFT")).toBeNull();
    expect(orderMove("sales", "DRAFT", "DRAFT")).toBeNull();
    expect(orderMove("sales", "constructor", "DRAFT")).toBeNull();
  });
});
