/**
 * SellerCtrl scrape worker.
 *
 * Polls the app's /api/scrape/worker/next for a pending job, then for each
 * product item opens its URL in a headless browser, extracts each field via the
 * recipe's CSS selector, and posts the result back. The app fills only missing
 * fields on the draft product and keeps it a draft until a reviewer confirms.
 *
 * Config (env):
 *   APP_URL          base URL of the app, e.g. https://sellerctrlops.vercel.app
 *   SCRAPER_TOKEN    shared bearer token (must match the app's SCRAPER_TOKEN)
 *   POLL_INTERVAL_MS idle poll interval (default 5000)
 *   ITEM_DELAY_MS    delay between items, politeness (default 1500)
 *   NAV_TIMEOUT_MS   per-page navigation timeout (default 30000)
 *   BROWSER_CHANNEL  optional Playwright channel ("msedge", "chrome"); default bundled chromium
 *   HEADLESS         "false" to show the browser (default true)
 */

import { chromium } from "playwright";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.SCRAPER_TOKEN || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const ITEM_DELAY_MS = Number(process.env.ITEM_DELAY_MS || 1500);
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 30000);
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || undefined;
const HEADLESS = process.env.HEADLESS !== "false";

if (!TOKEN) {
  console.error("[worker] SCRAPER_TOKEN is required");
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recoverStuckJobs() {
  try {
    const res = await fetch(`${APP_URL}/api/scrape/worker/recover`, { method: "POST", headers: authHeaders });
    if (res.ok) {
      const { requeued } = await res.json();
      if (requeued) console.log(`[worker] resumed ${requeued} interrupted job(s)`);
    }
  } catch (e) {
    console.error("[worker] recover failed:", e.message);
  }
}

async function claimJob() {
  const res = await fetch(`${APP_URL}/api/scrape/worker/next`, { headers: authHeaders });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`next -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function postResult(payload) {
  const res = await fetch(`${APP_URL}/api/scrape/worker/result`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`[worker] result -> ${res.status} ${await res.text()}`);
}

async function finishJob(jobId, status, error) {
  await fetch(`${APP_URL}/api/scrape/worker/finish`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ jobId, status, error }),
  }).catch((e) => console.error("[worker] finish failed", e));
}

/** Extract { field: value } for one page using the recipe selectors. */
async function extract(page, fields) {
  return page.evaluate((fieldsArg) => {
    const out = {};
    const toAbs = (v) => {
      try {
        return new URL(v, location.href).href;
      } catch {
        return v;
      }
    };
    for (const [key, def] of Object.entries(fieldsArg)) {
      const el = document.querySelector(def.selector);
      if (!el) continue;
      let value = "";
      const attr = def.attr || "text";
      if (attr === "text") value = (el.textContent || "").replace(/\s+/g, " ").trim();
      else if (attr === "src") value = toAbs(el.currentSrc || el.getAttribute("src") || el.src || "");
      else if (attr === "href") value = toAbs(el.getAttribute("href") || el.href || "");
      else if (attr === "content") value = el.getAttribute("content") || "";
      else value = el.getAttribute(attr) || "";
      if (value) out[key] = value;
    }
    return out;
  }, fields);
}

async function runJob(job, browser) {
  const { id: jobId, fields, items } = job;
  console.log(`[worker] job ${jobId}: ${items.length} item(s), fields: ${Object.keys(fields).join(", ")}`);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/120.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  for (const item of items) {
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded" });
      // give late content a moment (lazy images, JS-rendered specs)
      await page.waitForTimeout(800);
      const data = await extract(page, fields);
      console.log(`[worker]  ✓ ${item.url} -> ${Object.keys(data).join(", ") || "(nothing)"}`);
      await postResult({ jobId, productId: item.id, data });
    } catch (err) {
      console.error(`[worker]  ✗ ${item.url}: ${err.message}`);
      await postResult({ jobId, productId: item.id, error: String(err.message || err) });
    }
    await sleep(ITEM_DELAY_MS);
  }

  await context.close();
  await finishJob(jobId, "done");
  console.log(`[worker] job ${jobId} done`);
}

async function main() {
  console.log(`[worker] starting — app=${APP_URL} headless=${HEADLESS} channel=${BROWSER_CHANNEL || "chromium"}`);
  // Resume any job interrupted by a previous crash/stop.
  await recoverStuckJobs();
  const browser = await chromium.launch({ headless: HEADLESS, channel: BROWSER_CHANNEL });

  // graceful shutdown
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      stopping = true;
      console.log(`[worker] ${sig} — shutting down`);
      await browser.close().catch(() => {});
      process.exit(0);
    });
  }

  while (!stopping) {
    let job = null;
    try {
      job = await claimJob();
    } catch (err) {
      console.error("[worker] poll error:", err.message);
    }
    if (job) {
      try {
        await runJob(job, browser);
      } catch (err) {
        console.error(`[worker] job ${job.id} failed:`, err.message);
        await finishJob(job.id, "error", String(err.message || err));
      }
    } else {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
