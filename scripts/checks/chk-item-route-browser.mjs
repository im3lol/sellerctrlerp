/** Read-only browser checks for public item URLs. Does not submit the item form. */
import assert from 'node:assert/strict';
import pg from 'pg';
import { encode } from 'next-auth/jwt';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:3001', id = '24f911ae-537a-4519-b905-0c114d3710cc';
const baseline = process.argv.includes('--baseline');
const out = '.ops-data/item-routes-20261024'; await mkdir(out, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { chromium } = createRequire(join(process.env.MCP_QA_PACKAGES, 'package.json'))('playwright');
let browser;
try {
  const { rows: [item] } = await pool.query('select code,organization_id from items where id=$1', [id]); assert(item);
  const { rows: [u] } = await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1"); assert(u);
  const salt = 'authjs.session-token', token = await encode({ secret: process.env.AUTH_SECRET, salt, maxAge: 1200, token: { sub: u.id, id: u.id, name: u.name, role: u.role, sv: u.session_version } });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, timezoneId: 'Africa/Cairo' });
  await context.addCookies([{ name: salt, value: token, url: origin, httpOnly: true }, { name: 'erp_org', value: item.organization_id, url: origin }, { name: 'locale', value: 'ar', url: origin }]);
  const p = await context.newPage(); p.setDefaultTimeout(45000); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const canonical = '/inventory/items/' + encodeURIComponent(item.code);
  await p.goto(origin + '/inventory/items/' + id, { waitUntil: 'networkidle' });
  if (baseline) {
    assert.equal(new URL(p.url()).pathname, '/inventory/items/' + id);
    await p.screenshot({ path: join(out, 'before.png') }); console.log('BASELINE: legacy UUID remains in the address bar');
  } else {
    await p.waitForURL(origin + canonical);
    await p.locator(`main a[href="${canonical}/edit"]`).click();
    await p.waitForURL(origin + canonical + '/edit');
    await p.locator(`main a[href="${canonical}"]`).click();
    await p.waitForURL(origin + canonical);
    await p.goto(origin + '/inventory/items/' + id + '/edit', { waitUntil: 'networkidle' });
    await p.waitForURL(origin + canonical + '/edit');
    console.log('PASS supplied UUID bookmark, legacy edit bookmark, edit link and back link use current item code');
    await p.goto(origin + '/search?q=' + encodeURIComponent(item.code), { waitUntil: 'networkidle' });
    await p.locator(`main a[href="${canonical}"]`).first().click(); await p.waitForURL(origin + canonical);
    await p.goto(origin + '/apps', { waitUntil: 'networkidle' });
    await p.locator('header input').first().fill(item.code);
    // Wait for a record row, not the immediately visible "full search" button.
    const quickHit = p.locator('header button:has(.font-mono)').filter({ hasText: item.code }).first();
    await quickHit.waitFor({ state: 'visible' });
    await quickHit.click(); await p.waitForURL(origin + canonical);
    await p.screenshot({ path: join(out, 'after-ar.png') });
    console.log('PASS full search and quick search generate readable links directly');
    const checked = [];
    const uuid = /^\/inventory\/items\/[0-9a-f]{8}-[0-9a-f-]{27,}(?:\/|$)/i;
    for (const route of ['/inventory/items', '/inventory/stock', '/inventory/ledger', '/sales/reports/marketplace-pnl']) {
      await p.goto(origin + route, { waitUntil: 'networkidle' });
      const links = await p.locator('main a[href^="/inventory/items/"]').evaluateAll(xs => xs.map(x => x.getAttribute('href')));
      assert(links.every(h => !uuid.test(h)), 'UUID link in ' + route);
      checked.push({ route, links: links.length });
    }
    await context.addCookies([{ name: 'locale', value: 'en', url: origin }]);
    await p.goto(origin + '/inventory/items/' + id, { waitUntil: 'networkidle' }); await p.waitForURL(origin + canonical);
    await p.setViewportSize({ width: 390, height: 850 });
    await p.screenshot({ path: join(out, 'after-en-mobile.png'), fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    await writeFile(join(out, 'browser.json'), JSON.stringify({ canonical, bookmarkAndEdit: true, search: true, checked, englishAndMobile: true, errors, readOnly: true }, null, 2));
    console.log('PASS item/report links, English/mobile and zero browser errors; no forms submitted');
  }
} finally { await browser?.close(); await pool.end(); }
