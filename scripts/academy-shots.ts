import { chromium, type Page } from "playwright-core";
import { mkdirSync, statSync } from "node:fs";

/**
 * Captures the screenshots used by the written guides.
 *
 * Shots land in `public/academy/` and the guides reference them as `/academy/x.png` —
 * a RELATIVE url on purpose. Putting them in object storage would bake the storage
 * host into the guide text (`localhost:9000/...`), which is broken the moment the
 * guide renders anywhere but this laptop. They're small, they belong to the product,
 * and they change with the UI, so the repo is the right home.
 *
 * Drives the installed Edge via playwright-core — no browser download.
 *
 * Run against the local app with the seeded demo tenant:
 *   npx tsx scripts/academy-shots.ts
 */
const BASE = process.env.SHOT_BASE ?? "http://localhost:3001";
const EMAIL = process.env.SHOT_EMAIL ?? "admin@sellerctrl.com";
const PASSWORD = process.env.SHOT_PASSWORD ?? "password123";
const OUT = "public/academy";

type Shot = {
  file: string;
  url: string;
  /** Crop to this element instead of the viewport — a screenshot of the whole page is unreadable. */
  clip?: string;
  /** Run before the shot: open a dialog, expand a tree, scroll to a section. */
  setup?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  /* ── start-here ── */
  { file: "sidebar", url: "/dashboard", clip: "aside, nav" },

  /* ── chart-of-accounts ── */
  { file: "chart-tree", url: "/erp/accounting/chart", clip: "main",
    setup: async (p) => { await p.getByRole("button", { name: "توسيع الكل" }).click(); await p.waitForTimeout(400); } },
  { file: "chart-new-account", url: "/erp/accounting/chart", clip: "[role=dialog]",
    setup: async (p) => { await p.getByRole("button", { name: "حساب جديد" }).click(); await p.waitForTimeout(500); } },

  /* ── opening-balances ── */
  { file: "opening-balance", url: "/erp/settings/opening-balance", clip: "main" },

  /* ── sales-cycle ── */
  { file: "sales-orders", url: "/erp/sales/orders", clip: "main" },
  { file: "sales-order-new", url: "/erp/sales/orders/new", clip: "main" },
  { file: "sales-invoices", url: "/erp/sales/invoices", clip: "main" },

  /* ── purchase-cycle ── */
  { file: "purchase-order-new", url: "/erp/purchases/orders/new", clip: "main" },
  { file: "purchase-receipts", url: "/erp/purchases/receipts", clip: "main" },

  /* ── items ── */
  { file: "item-new", url: "/erp/inventory/items/new", clip: "main" },
  { file: "items-list", url: "/erp/inventory/items", clip: "main" },
  { file: "barcode-labels", url: "/erp/inventory/labels", clip: "main" },
];

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  // Fixed viewport so shots stay a consistent size across runs, and deviceScaleFactor
  // 2 so the text is legible when the guide scales the image down.
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "ar-EG",
  });
  const page = await ctx.newPage();

  await login(page);
  console.log("logged in");

  for (const s of SHOTS) {
    // Not networkidle: something in the app keeps a connection open, so it never
    // settles and every goto times out.
    await page.goto(`${BASE}${s.url}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load").catch(() => {});
    // Let fonts settle; Arabic reflows late and a shot mid-reflow looks broken.
    await page.waitForTimeout(1200);
    if (s.setup) await s.setup(page);

    const target = s.clip ? page.locator(s.clip).first() : page;
    const path = `${OUT}/${s.file}.png`;
    await target.screenshot({ path });
    console.log(`  ${s.file}.png  ${(statSync(path).size / 1024).toFixed(0)}kb`);
  }

  await browser.close();
  console.log(`\n✅ ${SHOTS.length} shots → ${OUT}/`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
