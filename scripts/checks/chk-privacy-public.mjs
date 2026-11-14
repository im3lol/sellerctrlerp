// Public-route and UI verification. No database writes or business API calls.
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { encode } from "next-auth/jwt";

const origin = process.env.PRIVACY_QA_ORIGIN ?? "http://127.0.0.1:3012";
const runtime = process.env.MCP_QA_PACKAGES;
if (!runtime) throw new Error("Set MCP_QA_PACKAGES to the bundled Playwright package directory");
const { chromium } = createRequire(join(runtime, "package.json"))("playwright");
const out = join(process.cwd(), ".next", "privacy-preview");
await mkdir(out, { recursive: true });
const check = (ok, label) => { if (!ok) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  const page = await context.newPage();
  const response = await page.goto(`${origin}/privacy-policy`);
  check(response.status() === 200 && new URL(page.url()).pathname === "/privacy-policy", "anonymous policy returns 200 without login or JavaScript");
  check(await page.getByRole("heading", { name: "Privacy Policy", exact: true }).count() === 1, "English default notice has one main title");
  check(await page.locator('div[lang="en"][dir="ltr"]').count() === 1, "English notice declares its own language and direction");
  check(await page.locator('link[rel="canonical"]').getAttribute("href") === "https://sellerctrl.com/privacy-policy", "canonical uses the public marketing domain");
  check(await page.locator('link[hreflang="ar"]').getAttribute("href") === "https://sellerctrl.com/privacy-policy?lang=ar", "Arabic alternate is discoverable");
  check(await page.locator("article section").count() === 16, "all fifteen topics and contact render server-side");
  const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(a => !document.getElementById(a.getAttribute("href").slice(1))).map(a => a.getAttribute("href")));
  check(broken.length === 0, "table of contents and skip link resolve to real anchors");
  check(await page.locator('#planned-ads').textContent().then(s => s.includes("not currently implemented") && s.includes("planned")), "Ads data processing is explicitly future functionality");
  check(await page.locator('a[href="mailto:info@sellerctrl.com"]').count() >= 1, "confirmed privacy contact is actionable");
  await page.screenshot({ path: join(out, "privacy-en-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "English mobile has no horizontal overflow");
  await page.screenshot({ path: join(out, "privacy-en-mobile.png") });
  await page.getByRole("link", { name: "العربية", exact: true }).click();
  check(await page.getByRole("heading", { name: "سياسة الخصوصية", exact: true }).isVisible(), "Arabic language link works without JavaScript");
  check(await page.locator('div[lang="ar"][dir="rtl"]').count() === 1, "Arabic notice has RTL and explicit language");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Arabic mobile has no horizontal overflow");
  await page.screenshot({ path: join(out, "privacy-ar-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(out, "privacy-ar-desktop.png") });
  const legacy = await context.request.get(`${origin}/privacy?lang=ar`, { maxRedirects: 0 });
  check(legacy.status() === 308 && legacy.headers().location === "/privacy-policy?lang=ar", "legacy privacy URL permanently redirects preserving Arabic");
  const signedIn = await browser.newContext({ javaScriptEnabled: false });
  const cookieName = "authjs.session-token";
  // Synthetic short-lived session only tests the proxy; no real user identity/data.
  const token = await encode({ secret: process.env.AUTH_SECRET, salt: cookieName, maxAge: 60, token: { sub: "privacy-public-check", id: "privacy-public-check", role: "employee", sv: 0 } });
  await signedIn.addCookies([{ name: cookieName, value: token, url: origin, httpOnly: true }, { name: "locale", value: "en", url: origin }]);
  const login = await signedIn.request.get(`${origin}/login`, { maxRedirects: 0 });
  check([302, 307].includes(login.status()) && new URL(login.headers().location, origin).pathname === "/apps", "synthetic session is recognized by the proxy");
  const signedPage = await signedIn.newPage();
  check((await signedPage.goto(`${origin}/privacy-policy`)).status() === 200 && await signedPage.getByRole("heading", { name: "Privacy Policy", exact: true }).isVisible(), "signed-in users can read the notice without an app redirect");
  const sitemap = await context.request.get(`${origin}/sitemap.xml`);
  check(sitemap.ok() && (await sitemap.text()).includes("https://sellerctrl.com/privacy-policy"), "sitemap lists the canonical legal URL");
  const home = await context.request.get(`${origin}/`);
  check(home.ok() && (await home.text()).includes('href="/privacy-policy"'), "marketing footer links to the notice");
  const loginPage = await context.request.get(`${origin}/login`);
  check(loginPage.ok() && (await loginPage.text()).includes('href="/privacy-policy"'), "login page links to the notice");
  console.log(`Screenshots: ${out}. No business data modified.`);
} finally { await browser.close(); }
