/** Navigation-only browser regression. No approvals, documents or settings are changed. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { encode } from 'next-auth/jwt';

const origin = process.env.APP_QA_ORIGIN || 'http://127.0.0.1:3001';
const baseline = process.argv.includes('--baseline');
const out = '.ops-data/approvals-nav-20261024'; await mkdir(out, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { chromium } = createRequire(join(process.env.MCP_QA_PACKAGES, 'package.json'))('playwright');
let browser;
try {
  const { rows: [u] } = await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
  assert(u);
  const salt = 'authjs.session-token', token = await encode({ secret: process.env.AUTH_SECRET, salt, maxAge: 1200, token: { sub: u.id, id: u.id, name: u.name, role: u.role, sv: u.session_version } });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1240, height: 950 }, colorScheme: 'light', timezoneId: 'Africa/Cairo' });
  await context.addCookies([{ name: salt, value: token, url: origin, httpOnly: true }, { name: 'erp_org', value: 'a57a738d-2f4e-4ab2-8127-2b3cc330f9b2', url: origin }, { name: 'nav_collapsed', value: '0', url: origin }]);
  const p = await context.newPage(); p.setDefaultTimeout(30000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  const results = [];
  for (const locale of baseline ? ['ar'] : ['ar', 'en']) {
    await context.addCookies([{ name: 'locale', value: locale, url: origin }, { name: 'nav_collapsed', value: '0', url: origin }]);
    await p.setViewportSize({ width: 1240, height: 950 });
    await p.goto(origin + '/approvals?tab=done', { waitUntil: 'networkidle' });
    if (baseline) {
      assert.equal(await p.locator('aside').count(), 0);
      await p.screenshot({ path: join(out, 'before.png') });
      console.log('BASELINE confirmed: approvals have no sidebar'); break;
    }
    const aside = p.locator('aside');
    await aside.waitFor({ state: 'visible' });
    const approval = aside.locator('a[href="/approvals"]');
    await approval.waitFor({ state: 'visible' });
    assert((await approval.getAttribute('class')).includes('bg-sidebar-foreground'));
    await p.screenshot({ path: join(out, `desktop-${locale}.png`) });
    for (const tab of ['pending', 'mine', 'tasks', 'late', 'done']) {
      await p.goto(origin + '/approvals?tab=' + tab, { waitUntil: 'domcontentloaded' });
      await aside.waitFor({ state: 'visible' });
      await approval.waitFor({ state: 'visible' });
    }
    await aside.locator('button[aria-label]').first().click();
    await p.waitForFunction(() => document.querySelector('aside')?.getBoundingClientRect().width < 80);
    await approval.waitFor({ state: 'visible' });
    await aside.locator('button[aria-label]').first().click();
    await p.waitForFunction(() => document.querySelector('aside')?.getBoundingClientRect().width > 240);
    await aside.locator('nav a[href="/apps"]').click();
    await p.waitForURL(origin + '/apps');
    await p.goto(origin + '/approvals', { waitUntil: 'networkidle' });
    await p.locator('main a[href="/apps"]').click();
    await p.waitForURL(origin + '/apps');
    await p.setViewportSize({ width: 390, height: 850 });
    await p.goto(origin + '/approvals', { waitUntil: 'networkidle' });
    const menu = p.getByRole('button', { name: locale === 'ar' ? 'القائمة' : 'Menu', exact: true });
    await menu.waitFor({ state: 'visible' });
    await menu.click();
    const drawer = p.getByRole('dialog');
    await drawer.waitFor({ state: 'visible' });
    await drawer.locator('a[href="/approvals"]').waitFor({ state: 'visible' });
    await p.waitForFunction(locale => {
      const b = document.querySelector('[data-slot="sheet-content"]')?.getBoundingClientRect();
      return b && (locale === 'ar' ? Math.abs(b.right - innerWidth) < 2 : Math.abs(b.left) < 2);
    }, locale);
    await p.screenshot({ path: join(out, `mobile-${locale}.png`) });
    const box = await drawer.boundingBox();
    assert(box); assert(locale === 'ar' ? Math.abs(box.x + box.width - 390) < 2 : Math.abs(box.x) < 2, 'Drawer must follow the language direction');
    await drawer.locator('nav a[href="/apps"]').click();
    await p.waitForURL(origin + '/apps');
    await drawer.waitFor({ state: 'hidden' });
    results.push({ locale, desktopSidebar: true, allTabs: true, collapsedRail: true, backAndAppsLinks: true, mobileDrawerAndNavigation: true });
    console.log('PASS', locale, 'desktop sidebar, all approval tabs, collapse/expand, back to apps, mobile drawer and navigation');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  if (!baseline) await writeFile(join(out, 'browser.json'), JSON.stringify({ results, errors, navigationOnly: true }, null, 2));
} finally { await browser?.close(); await pool.end(); }
