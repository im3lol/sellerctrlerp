/** Actual Ctrl+V in hydrated forms; never saves or submits a document. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { encode } from 'next-auth/jwt';

const origin = process.env.CLIPBOARD_QA_ORIGIN || 'http://127.0.0.1:3015';
const clone = new URL(process.env.DATABASE_URL);
assert.equal(clone.pathname, '/sellerctrl_landed_test_audit_20261024');
const pool = new pg.Pool({ connectionString: clone.href });
const { chromium } = createRequire(join(process.env.MCP_QA_PACKAGES, 'package.json'))('playwright');
const orgId = 'a57a738d-2f4e-4ab2-8127-2b3cc330f9b2';
const out = '.ops-data/clipboard-20261024'; await mkdir(out, { recursive: true });
let browser;
try {
  const { rows: [user] } = await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
  const { rows: catalog } = await pool.query('select code from items where organization_id=$1 and is_active=true order by code limit 12', [orgId]);
  assert.equal(catalog.length, 12);
  const count = async () => (await pool.query('select (select count(*) from stock_movements) as movements,(select count(*) from journal_entries) as journals,(select count(*) from material_requests) as requisitions,(select count(*) from stock_adjustments) as adjustments,(select count(*) from stock_transfers) as transfers')).rows[0];
  const before = await count();
  const salt = 'authjs.session-token';
  const token = await encode({ secret: process.env.AUTH_SECRET, salt, maxAge: 1800, token: { sub: user.id, id: user.id, name: user.name, role: user.role, sv: user.session_version } });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1240, height: 950 }, permissions: ['clipboard-read', 'clipboard-write'], timezoneId: 'Africa/Cairo' });
  await context.addCookies([{ name: salt, value: token, url: origin, httpOnly: true }, { name: 'erp_org', value: orgId, url: origin }, { name: 'locale', value: 'ar', url: origin }]);
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  async function open(path) {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-paste-column]').first().waitFor();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  const field = key => page.locator(`input[data-paste-column="${key}"]`);
  async function paste(key, text, row = 0) {
    let target = key === 'itemId' ? page.locator('td[data-paste-column="itemId"]').nth(row) : field(key).nth(row);
    if (key === 'itemId') {
      if (await target.locator('button').count()) await target.locator('button').first().click();
      target = target.locator('input');
    }
    await target.focus();
    await page.evaluate(text => navigator.clipboard.writeText(text), text);
    await target.press('Control+V');
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(x => /جارٍ التحقق|Checking pasted/.test(x.textContent)));
  }
  const results = [];
  for (const [path, quantity, price] of [
    ['/purchases/orders/new', 'quantity', 'unitPrice'], ['/sales/orders/new', 'quantity', 'unitPrice'],
    ['/sales/quotations/new', 'quantity', 'unitPrice'], ['/purchases/requisitions/new', 'quantity', null],
    ['/inventory/transfers/new', 'quantity', null], ['/inventory/adjustments/new', 'counted', 'unitCost'],
  ]) {
    await open(path);
    if (['/purchases/orders/new', '/sales/orders/new', '/sales/quotations/new'].includes(path)) {
      for (const checkbox of await page.locator('input[type="checkbox"]:checked').all()) await checkbox.uncheck();
    }
    const rectangle = catalog.slice(0, 2).map((it, i) => `${it.code}\t${i + 2}${price ? '\t' + ((i + 1) * 10) : ''}`).join('\r\n');
    await paste('itemId', rectangle);
    await page.waitForFunction(key => document.querySelectorAll(`input[data-paste-column="${key}"]`).length === 2, quantity);
    assert.deepEqual(await field(quantity).evaluateAll(xs => xs.map(x => x.value)), ['2', '3']);
    if (price) assert.deepEqual(await field(price).evaluateAll(xs => xs.map(x => x.value)), ['10', '20']);
    if (path.startsWith('/sales/') || path === '/purchases/orders/new') {
      const rows = page.locator('table').first().locator('tbody tr');
      assert.equal(Number((await rows.nth(0).locator('td').nth(-3).innerText()).replace(/,/g, '')), 20);
      assert.equal(Number((await rows.nth(1).locator('td').nth(-3).innerText()).replace(/,/g, '')), 60);
    }
    await paste(quantity, '٥\n٦\n');
    assert.deepEqual(await field(quantity).evaluateAll(xs => xs.map(x => x.value)), ['5', '6']);
    const old = await field(quantity).evaluateAll(xs => xs.map(x => x.value));
    await paste(quantity, '9\nINVALID');
    assert.deepEqual(await field(quantity).evaluateAll(xs => xs.map(x => x.value)), old, 'Invalid numeric data must be atomic');
    await paste('itemId', `${catalog[0].code}\t8\nMISSING-CLIPBOARD-ITEM\t9`);
    assert.deepEqual(await field(quantity).evaluateAll(xs => xs.map(x => x.value)), old, 'Missing code must be atomic');
    const headers = page.locator('table').first().locator('thead tr').first().locator('th');
    assert.equal(await headers.count(), await page.locator('table').first().locator('tbody tr').first().locator('td').count());
    results.push({ path, pass: true }); console.log('PASS', path, 'rectangle, Arabic numbers, invalid data atomicity and header alignment');
  }
  await open('/purchases/orders/new');
  await paste('itemId', catalog[0].code);
  await paste('itemId', catalog[0].code);
  await page.locator('td[data-paste-column="itemId"] button').first().waitFor({ state: 'visible' });
  assert(await page.locator('td[data-paste-column="itemId"] button').first().isVisible(), 'Pasting the same code must finish the item search');
  await paste('itemId', catalog.map(it => it.code).join('\n'));
  assert.equal(await field('quantity').count(), 10, 'Stay on the first page after adding twelve rows');
  const quantities = Array.from({ length: 12 }, (_, i) => String(i + 1));
  await paste('quantity', quantities.join('\n'));
  assert.deepEqual(await field('quantity').evaluateAll(xs => xs.map(x => x.value)), quantities.slice(0, 10));
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  assert.deepEqual(await field('quantity').evaluateAll(xs => xs.map(x => x.value)), ['11', '12']);
  await paste('unitPrice', '12.5\n15');
  assert.deepEqual(await field('unitPrice').evaluateAll(xs => xs.map(x => x.value)), ['12.5', '15']);
  const latestToast = page.locator('[data-sonner-toast][data-front="true"]').filter({ hasText: 'تم لصق 2 صف' });
  await latestToast.hover();
  await latestToast.getByRole('button', { name: 'تراجع', exact: true }).click();
  assert.notDeepEqual(await field('unitPrice').evaluateAll(xs => xs.map(x => x.value)), ['12.5', '15']);
  await page.screenshot({ path: join(out, 'purchase-order-ar.png'), fullPage: true });
  results.push({ paginationAndUndo: true }); console.log('PASS twelve-row paste, current-page retention, second-page offset and undo');

  // While item resolution is in flight, manual typing must win over its late result.
  await open('/purchases/orders/new');
  let release, intercepted;
  const blocked = new Promise(r => { intercepted = r; });
  await page.route('**/purchases/orders/new', async route => {
    if (route.request().method() === 'POST' && route.request().postData()?.includes(catalog[0].code)) {
      intercepted(); await new Promise(r => { release = r; });
    }
    await route.continue();
  });
  const input = page.locator('td[data-paste-column="itemId"] input').first();
  await input.focus(); await page.evaluate(s => navigator.clipboard.writeText(s), catalog[0].code + '\n' + catalog[1].code); await input.press('Control+V');
  await blocked; await field('quantity').first().fill('9'); release();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-sonner-toast]')].some(x => x.textContent.includes('اتغير الجدول أثناء اللصق')));
  assert.equal(await field('quantity').count(), 1); assert.equal(await field('quantity').first().inputValue(), '9');
  await page.unroute('**/purchases/orders/new');
  results.push({ lateResponseProtection: true }); console.log('PASS late server response cannot overwrite manual edits');

  await context.addCookies([{ name: 'locale', value: 'en', url: origin }]);
  await open('/purchases/orders/new');
  await paste('itemId', `${catalog[0].code}\t2\t12.5\n${catalog[1].code}\t3\t20`);
  assert.deepEqual(await field('unitPrice').evaluateAll(xs => xs.map(x => x.value)), ['12.5', '20']);
  await page.setViewportSize({ width: 390, height: 850 });
  await page.screenshot({ path: join(out, 'purchase-order-en-mobile.png'), fullPage: true });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.deepEqual(await count(), before, 'Paste must not post inventory, journals or documents');
  await writeFile(join(out, 'browser.json'), JSON.stringify({ results, errors, noBusinessWrites: true }, null, 2));
  console.log('PASS English/mobile and no business writes');
} finally { await browser?.close(); await pool.end(); }
