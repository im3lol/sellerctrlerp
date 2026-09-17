import { describe, it, expect } from "vitest";
import { BillSchema, billDate, billWarnings, matchSupplier, priceReceiptLines, type Bill } from "@/lib/erp/ai-bill";

const bill = (over: Partial<Bill> = {}): Bill => ({
  kind: "goods", supplierName: "شركة النور للتجارة", supplierTaxNumber: "123-456-789",
  invoiceNumber: "INV-9", invoiceDate: "2026-09-10", currency: "EGP",
  lines: [{ description: "شنطة", code: "B-1", quantity: 10, unitPrice: 50, taxRate: 14 }],
  subtotal: 500, tax: 70, total: 570, ...over,
});

describe("a read bill", () => {
  it("is exactly the shape the model is asked for", () => {
    expect(BillSchema.safeParse(bill()).success).toBe(true);
    expect(BillSchema.safeParse({ ...bill(), lines: [{ description: "x" }] }).success).toBe(false);
  });

  it("keeps a real date and drops anything else", () => {
    expect(billDate("2026-09-10")).toBe("2026-09-10");
    expect(billDate("2026-02-30")).toBeNull();
    expect(billDate("10/09/2026")).toBeNull();
    expect(billDate(null)).toBeNull();
  });

  it("raises nothing when the arithmetic holds", () => {
    expect(billWarnings(bill())).toEqual([]);
  });

  it("points at lines that don't add up, and a total that isn't net + tax", () => {
    const w = billWarnings(bill({ subtotal: 600, total: 900 }));
    expect(w.some((x) => x.includes("مجموع البنود"))).toBe(true);
    expect(w.some((x) => x.includes("الإجمالي (900)"))).toBe(true);
  });

  it("tolerates rounding — a pound, or one percent", () => {
    expect(billWarnings(bill({ subtotal: 500.6, total: 570.6 }))).toEqual([]);
  });
});

describe("the bill's prices onto the receipt", () => {
  const receipt = [
    { itemId: "bag", name: "شنطة جلد سوداء", codes: ["P-001", "B-1"], quantity: 8 },
    { itemId: "belt", name: "حزام رجالي", codes: ["P-002"], quantity: 5 },
    { itemId: "wallet", name: "محفظة", codes: ["P-003"], quantity: 3 },
  ];

  it("claims by code first, and taxes the received quantity at the bill's rate", () => {
    // The description names nothing on the receipt — only the code can find it.
    const b = bill({ lines: [{ description: "Item as the supplier calls it", code: "p 001", quantity: 10, unitPrice: 50, taxRate: 14 }] });
    const { priced, unmatchedBill } = priceReceiptLines(b, receipt);
    expect(priced).toEqual([{ itemId: "bag", unitPrice: 50, taxAmount: 56, billLine: 0 }]); // 8 × 50 × 14%
    expect(unmatchedBill).toEqual([]);
  });

  it("falls back to the name, and uses each receipt line once", () => {
    const b = bill({ lines: [
      { description: "حزام رجالى", code: null, quantity: 5, unitPrice: 40, taxRate: null },
      { description: "حزام رجالي", code: null, quantity: 1, unitPrice: 41, taxRate: null },
    ] });
    const { priced, unmatchedBill } = priceReceiptLines(b, receipt);
    expect(priced).toEqual([{ itemId: "belt", unitPrice: 40, taxAmount: 0, billLine: 0 }]);
    expect(unmatchedBill).toEqual([1]);
  });

  it("reports a bill line that matches nothing instead of forcing it", () => {
    const b = bill({ lines: [{ description: "خدمة شحن", code: "SHIP", quantity: 1, unitPrice: 100, taxRate: 14 }] });
    expect(priceReceiptLines(b, receipt)).toEqual({ priced: [], unmatchedBill: [0] });
  });
});

describe("finding the supplier on our side", () => {
  const suppliers = [
    { id: "a", nameAr: "مؤسسة الأمل", taxNumber: null },
    { id: "n", nameAr: "النور للتجاره", taxNumber: "123456789" },
    { id: "z", nameAr: "الزهراء", taxNumber: "999999999" },
  ];

  it("matches by tax number first, whatever the punctuation", () => {
    expect(matchSupplier(bill({ supplierName: "اسم مختلف" }), suppliers)?.id).toBe("n");
  });

  it("falls back to the name, forgiving ة/ه, أ/ا and company words", () => {
    expect(matchSupplier(bill({ supplierTaxNumber: null }), suppliers)?.id).toBe("n");
    expect(matchSupplier(bill({ supplierTaxNumber: null, supplierName: "الامل" }), suppliers)?.id).toBe("a");
  });

  it("finds nothing rather than guessing", () => {
    expect(matchSupplier(bill({ supplierTaxNumber: null, supplierName: "مورد جديد" }), suppliers)).toBeNull();
    expect(matchSupplier(bill({ supplierTaxNumber: null, supplierName: null }), suppliers)).toBeNull();
  });
});
