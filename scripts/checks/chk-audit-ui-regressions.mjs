/** Real browser actions are restricted to the named outbound-blocked audit clone. */
import pg from 'pg';
import {encode} from 'next-auth/jwt';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const url=new URL(process.env.DATABASE_URL);assert.equal(url.pathname,'/sellerctrl_landed_test_audit_20261024');
const origin='http://127.0.0.1:3015',dir='.ops-data/system-audit-20261024/';
const pool=new pg.Pool({connectionString:url.href});const {chromium}=createRequire(join(process.env.MCP_QA_PACKAGES,'package.json'))('playwright');let browser;
try {
 const f=JSON.parse(await readFile(dir+'core-cycle.json','utf8'));const orgId=f.orgId;
 const {rows:[u]}=await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
 const {rows:[existing]}=await pool.query('select id from items where organization_id=$1 order by code limit 1',[orgId]);
 const {rows:[wh]}=await pool.query('select id from warehouses where organization_id=$1 limit 1',[orgId]);
 const extra=randomUUID(),adj=randomUUID(),number='ADJ-QA-'+Date.now();
 await pool.query('begin');
 try {
  await pool.query("insert into items(id,organization_id,code,name_ar) values($1,$2,$3,'QA second cycle item')",[extra,orgId,'CYCLE-J-'+Date.now()]);
  await pool.query("insert into stock_adjustments(id,organization_id,number,date,reason,status) values($1,$2,$3,now(),'Browser reorder QA','DRAFT')",[adj,orgId,number]);
  for(const [item,quantity]of [[existing.id,9],[extra,0]]) await pool.query("insert into stock_adjustment_lines(id,organization_id,stock_adjustment_id,item_id,warehouse_id,mode,entered_value,unit_cost) values($1,$2,$3,$4,$5,'set',$6,105)",[randomUUID(),orgId,adj,item,wh.id,quantity]);
  await pool.query('commit');
 }catch(e){await pool.query('rollback');throw e;}
 const {rows:[before]}=await pool.query('select count(*)::int n from journal_entries where organization_id=$1',[orgId]);
 const salt='authjs.session-token',token=await encode({secret:process.env.AUTH_SECRET,salt,maxAge:3600,token:{sub:u.id,id:u.id,name:u.name,role:u.role,sv:u.session_version}});
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Africa/Cairo'});
 await context.addCookies([{name:salt,value:token,url:origin,httpOnly:true},{name:'erp_org',value:orgId,url:origin},{name:'locale',value:'ar',url:origin}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('CLIENT ERROR',new URL(page.url()).pathname,e.message);});
 await page.goto(origin+'/accounting/assets/new',{waitUntil:'networkidle'});
 await page.locator('#code').fill('QA-ASSET-'+Date.now());await page.locator('#nameAr').fill('Audit existing asset');await page.locator('#purchaseDate').fill('2026-10-24');await page.locator('#purchaseCost').fill('100');await page.locator('#salvageValue').fill('200');
 await Promise.all([page.waitForURL(u=>u.searchParams.has('error')),page.getByRole('button',{name:'حفظ الأصل',exact:true}).click()]);
 assert(decodeURIComponent(page.url()).includes('قيمة الخردة'),'Invalid input surfaces action error');console.log('PASS asset invalid action returns a visible error without page crash');
 const code='QA-ASSET-'+Date.now();await page.locator('#code').fill(code);await page.locator('#nameAr').fill('Audit existing asset');await page.locator('#purchaseDate').fill('2026-10-24');await page.locator('#purchaseCost').fill('100');await page.locator('#salvageValue').fill('10');
 await Promise.all([page.waitForURL(u=>/^\/accounting\/assets\/[^/]+$/.test(u.pathname)&&!u.pathname.endsWith('/new')),page.getByRole('button',{name:'حفظ الأصل',exact:true}).click()]);
 const {rows:[asset]}=await pool.query('select id,purchase_cost from fixed_assets where organization_id=$1 and code=$2',[orgId,code]);assert(asset&&Number(asset.purchase_cost)===100);console.log('PASS asset valid action persists exactly in audit tenant');
 await context.addCookies([{name:'locale',value:'en',url:origin}]);await page.goto(origin+'/accounting/assets/new',{waitUntil:'networkidle'});await page.locator('#code').waitFor();console.log('PASS English asset page renders');
 await context.addCookies([{name:'locale',value:'ar',url:origin}]);await page.goto(origin+'/inventory/adjustments/'+number,{waitUntil:'networkidle'});
 const table=page.locator('table').filter({has:page.locator('input[type=number]')}).first();const rows=table.locator('tbody tr').filter({has:page.locator('input[type=number]')});assert.equal(await rows.count(),2);
 const beforeOrder=await rows.locator('td:nth-child(2)').allTextContents();const firstInput=rows.first().locator('input[type=number]').first();await firstInput.fill('8');
 await rows.first().getByRole('button',{name:'نقل لأسفل',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('table tbody tr td:nth-child(2)')?.textContent?.includes('CYCLE-J'));
 const afterOrder=await rows.locator('td:nth-child(2)').allTextContents();assert.deepEqual(afterOrder,[beforeOrder[1],beforeOrder[0]]);assert.equal(await rows.nth(1).locator('input[type=number]').first().inputValue(),'8');console.log('PASS adjustment reorders immediately and preserves edits on the correct item');
 const geometry=await table.evaluate(t=>{const h=[...t.tHead.rows[0].cells],f=[...t.tFoot.rows[0].cells];return{headers:h.reduce((s,c)=>s+c.colSpan,0),footer:f.reduce((s,c)=>s+c.colSpan,0),valueOffset:Math.abs(h[7].getBoundingClientRect().left-f[1].getBoundingClientRect().left)}});assert.equal(geometry.headers,geometry.footer);assert(geometry.valueOffset<1.1);console.log('PASS adjustment footer aligns with estimated value column');
 await page.screenshot({path:dir+'adjustment-after.png',fullPage:true});
 await context.addCookies([{name:'locale',value:'en',url:origin}]);const {rows:[po]}=await pool.query('select number from purchase_orders where id=$1',[f.po]);await page.goto(origin+'/purchases/orders/'+po.number,{waitUntil:'networkidle'});
 const poTable=page.locator('table').filter({has:page.locator('tfoot')}).first();const widths=await poTable.evaluate(t=>({head:[...t.tHead.rows[0].cells].reduce((s,c)=>s+c.colSpan,0),foot:[...t.tFoot.rows[0].cells].reduce((s,c)=>s+c.colSpan,0),body:[...t.tBodies[0].rows[0].cells].reduce((s,c)=>s+c.colSpan,0)}));assert.equal(widths.head,8);assert.equal(widths.head,widths.foot);assert.equal(widths.head,widths.body);console.log('PASS purchase detail header/body/footer have eight aligned columns');
 const {rows:[after]}=await pool.query('select count(*)::int n from journal_entries where organization_id=$1',[orgId]);assert.equal(before.n,after.n);assert.equal(errors.length,0,errors.join('\n'));console.log('PASS existing asset registration and UI-only reorder create no journal entries');
 await writeFile(dir+'ui-regressions.json',JSON.stringify({passed:true,orgId,assetId:asset.id,adjustmentId:adj,adjustmentNumber:number,geometry,widths,clientErrors:errors},null,2));
}finally{await browser?.close();await pool.end();}
