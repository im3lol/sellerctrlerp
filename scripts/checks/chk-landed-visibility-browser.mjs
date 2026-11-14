/** Read-only UI regression: selecting and previewing never saves or posts. */
import assert from 'node:assert/strict';
import pg from 'pg';
import {encode} from 'next-auth/jwt';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const out='.ops-data/landed-visibility-20261024',origin='http://127.0.0.1:3001';
const f=JSON.parse(await readFile(join(out,'browser-fixture.json'),'utf8'));
const {chromium}=createRequire(join(process.env.MCP_QA_PACKAGES,'package.json'))('playwright');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});let browser;
try{
 const {rows:[u]}=await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
 const salt='authjs.session-token',token=await encode({secret:process.env.AUTH_SECRET,salt,maxAge:1800,token:{sub:u.id,id:u.id,name:u.name,role:u.role,sv:u.session_version}});
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1280,height:950}});
 await ctx.addCookies([{name:salt,value:token,url:origin,httpOnly:true},{name:'erp_org',value:f.orgId,url:origin},{name:'locale',value:'ar',url:origin}]);const p=await ctx.newPage();p.setDefaultTimeout(30000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 for(const locale of ['ar','en']){
 await ctx.addCookies([{name:'locale',value:locale,url:origin}]);
 await p.goto(origin+'/purchases/landed-costs/new',{waitUntil:'networkidle'});
 await p.getByPlaceholder(locale==='ar'?'ابحث باسم المورّد…':'Search by supplier name…',{exact:true}).fill(f.receipt.supplierName);
 await p.getByRole('button').filter({hasText:f.receipt.supplierName}).last().click();
 const receipt=p.locator('label').filter({hasText:f.receipt.number}).filter({has:p.locator('input[type=checkbox]')});assert.equal(await receipt.count(),0,'fully costed receipt hidden initially');
 const search=p.getByPlaceholder(locale==='ar'?'ابحث برقم الإذن أو التاريخ…':'Search by receipt number or date…',{exact:true});await search.fill(f.receipt.number);
 await receipt.locator('input').check();
 const itemName=locale==='ar'?'بحث أصناف تكاليف الاستيراد':'Search landed-cost items';const items=p.getByRole('textbox',{name:itemName,exact:true});await items.waitFor();
 const allCostChecks=p.locator('table input[type=checkbox]');assert((await allCostChecks.count())>0,'receipt search reveals historical products');assert.equal(await p.locator('table input[type=checkbox]:checked').count(),0,'history is never preselected');
 await search.fill('');assert.equal(await allCostChecks.count(),0,'old lines hidden when receipt search cleared');
 const code=f.lines[0].code;await items.fill(code);
 const checks=p.locator('table input[type=checkbox]');assert.equal(await checks.count(),1,'exact item code reveals one product');
 await p.getByRole('button',{name:locale==='ar'?'اختيار كل الأصناف':'Select all items',exact:true}).click();
 assert.equal(await p.locator('table input[type=checkbox]:checked').count(),1,'select all scoped to visible results');
 await items.fill('');assert.equal(await allCostChecks.count(),1,'chosen old item remains visible when search clears');
 await p.locator('select:has(option[value=manual])').selectOption('manual');
 const per=p.getByRole('spinbutton',{name:locale==='ar'?`شحن لكل وحدة للصنف ${code}`:`Freight per unit for item ${code}`,exact:true});await per.fill('2.5');
 const row=p.getByRole('row').filter({has:p.locator('input[type=checkbox]')});assert((await row.last().textContent()).includes((f.lines[0].quantity*2.5).toLocaleString('ar-EG-u-nu-latn',{minimumFractionDigits:2,maximumFractionDigits:2})),'manual additional freight preview');
 assert.equal(await receipt.locator('input').isChecked(),true,'selected historical receipt retained');
 await p.setViewportSize({width:390,height:850});await items.scrollIntoViewIfNeeded();await p.screenshot({path:join(out,`search-${locale}-mobile.png`)});assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)),'mobile viewport overflow');await p.setViewportSize({width:1280,height:950});
 console.log('PASS '+locale+': hide default, receipt and product search, no preselection, visible-only bulk selection, selected history retained, manual preview and mobile.');
 }
 assert.equal(errors.length,0,errors.join('\n'));await writeFile(join(out,'browser.json'),JSON.stringify({locales:['ar','en'],errors,readOnly:true},null,2));
}finally{await browser?.close();await pool.end();}
