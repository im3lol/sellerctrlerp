/** Read-only Buy Box visual and navigation regression. Never refreshes marketplace data. */
import assert from 'node:assert/strict';
import pg from 'pg';import {encode} from 'next-auth/jwt';import {createRequire} from 'node:module';import {join} from 'node:path';import {writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:3001',org='a57a738d-2f4e-4ab2-8127-2b3cc330f9b2',route='/platforms/amazon/buy-box',out='.ops-data/buy-box-ui-20261024';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const{chromium}=createRequire(join(process.env.MCP_QA_PACKAGES,'package.json'))('playwright');let browser;
try{
 const {rows:[u]}=await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
 const{rows:data}=await pool.query("select i.name_ar,i.code,i.image,o.sku,o.my_price,o.buy_box_price,o.lowest_price,o.offer_count,o.is_winner,o.lost_since from platform_offers o join items i on i.id=o.item_id where o.organization_id=$1 and o.channel='AMAZON'",[org]);assert(data.length>0);
 const salt='authjs.session-token',token=await encode({secret:process.env.AUTH_SECRET,salt,maxAge:1800,token:{sub:u.id,id:u.id,name:u.name,role:u.role,sv:u.session_version}});
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1280,height:950}});await ctx.addCookies([{name:salt,value:token,url:origin,httpOnly:true},{name:'erp_org',value:org,url:origin},{name:'nav_collapsed',value:'0',url:origin}]);
 const p=await ctx.newPage();p.setDefaultTimeout(30000);const errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));
 const money=v=>v==null?'—':Number(v).toLocaleString('ar-EG-u-nu-latn',{maximumFractionDigits:2});
 for(const locale of ['ar','en']){
  await ctx.addCookies([{name:'locale',value:locale,url:origin}]);await p.goto(origin+route,{waitUntil:'networkidle'});
  const table=p.locator('[data-buy-box-table] table');assert.equal(await table.locator('thead th').count(),7);assert.equal(await table.locator('tbody tr').count(),data.length);
  for(const d of data){const row=table.locator('tbody tr').filter({hasText:d.code});assert.equal(await row.count(),1);const cells=row.locator('td');assert.equal(await cells.count(),7);
   const name=row.locator('[dir=auto]').first();assert.equal(await name.textContent(),d.name_ar);const text=await cells.nth(0).textContent();assert(text.includes(d.sku));assert(text.includes(d.code));
   assert.equal((await cells.nth(1).textContent()).trim(),money(d.my_price));assert.equal((await cells.nth(2).textContent()).trim(),money(d.buy_box_price));assert.equal((await cells.nth(4).textContent()).trim(),money(d.lowest_price));assert.equal((await cells.nth(5).textContent()).trim(),String(d.offer_count));
   const gap=d.my_price!=null&&d.buy_box_price!=null?Number(d.my_price)-Number(d.buy_box_price):null;assert.equal((await cells.nth(3).textContent()).trim(),gap==null?'—':`${gap>0?'+':''}${gap.toLocaleString('ar-EG-u-nu-latn',{maximumFractionDigits:2})}`);
   const status=d.is_winner===true?(locale==='ar'?'معاك':'With you'):d.is_winner===false?(locale==='ar'?'خسرته':'You lost it'):(locale==='ar'?'مفيش Buy Box':'No Buy Box');assert((await cells.nth(6).textContent()).includes(status));
   if(d.image){assert.equal(await row.locator('img').getAttribute('src'),d.image);const box=await row.locator('img').boundingBox();assert(box.width>=45&&box.height>=45);}
   if(d.is_winner===false&&d.lost_since){assert.equal(await row.locator('time').getAttribute('datetime'),new Date(d.lost_since).toISOString());assert(await row.locator('time').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'loss date must wrap instead of clipping');}
  }
  const link=p.locator(`aside nav a[href="${route}"]`);await link.waitFor({state:'visible'});assert(!(await p.locator('aside nav a[href="/platforms/amazon/import"]').count()),'inactive platform must not gain sync tools');
  await p.waitForFunction(()=>{const img=document.querySelector('[data-buy-box-table] tbody img');return img?.complete&&img.naturalWidth>0;});
  await p.screenshot({path:join(out,`${locale}-desktop.png`)});
  await p.locator('aside button[aria-expanded]').first().click();await p.locator(`aside nav a[href="${route}"]`).waitFor({state:'visible'});await p.locator('aside button[aria-expanded]').first().click();
  await p.setViewportSize({width:390,height:850});await p.getByRole('button',{name:locale==='ar'?'القائمة':'Menu',exact:true}).click();const drawer=p.getByRole('dialog');const mobileLink=drawer.locator(`a[href="${route}"]`);await mobileLink.waitFor({state:'visible'});await mobileLink.click();await drawer.waitFor({state:'hidden'});
  assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)),'document must not overflow horizontally');
  const scroller=p.locator('[data-buy-box-table] [data-slot=table-container]');assert(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth),'all columns remain in a scrollable table on mobile');assert(await table.locator('tbody td').first().evaluate(el=>el.getBoundingClientRect().width<=el.closest('[data-slot=table-container]').clientWidth+2),'product column fits mobile viewport');
  await p.screenshot({path:join(out,`${locale}-mobile.png`)});await table.locator('th').last().scrollIntoViewIfNeeded();assert(await table.locator('th').last().isVisible());
  checks.push({locale,rows:data.length,columns:7,allValuesPreserved:true,fullNames:true,images:true,lossDates:true,desktopRailAndMobileNav:true});await p.setViewportSize({width:1280,height:950});console.log('PASS '+locale+': all '+data.length+' rows and 7 columns, full names/images/values/dates, desktop+collapsed+mobile navigation and horizontal table scroll.');
 }
 assert.equal(errors.length,0,errors.join('\n'));const {rows:[state]}=await pool.query("select is_active from sales_platforms where organization_id=$1 and code='AMAZON'",[org]);assert.equal(state.is_active,false);await writeFile(join(out,'browser.json'),JSON.stringify({checks,errors,platformRemainsInactive:true,readOnly:true},null,2));
}finally{await browser?.close();await pool.end();}
