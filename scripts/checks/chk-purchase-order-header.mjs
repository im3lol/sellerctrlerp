// Authenticated browser regression. Does not save, submit, or modify business documents.
import pg from 'pg';import {encode} from 'next-auth/jwt';import {createRequire}from'node:module';import{mkdir}from'node:fs/promises';import{join}from'node:path';import assert from'node:assert/strict';
const {chromium}=createRequire(join(process.env.MCP_QA_PACKAGES,'package.json'))('playwright');const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const origin='http://127.0.0.1:3001';const baseline=process.argv.includes('--baseline');const out=join(process.cwd(),'.ops-data','po-header-20261024');await mkdir(out,{recursive:true});let browser;
try{
 const{rows:[u]}=await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by tour_dismissed desc,created_at limit 1");assert(u);
 const salt='authjs.session-token';const token=await encode({secret:process.env.AUTH_SECRET,salt,maxAge:600,token:{sub:u.id,id:u.id,name:u.name,role:u.role,sv:u.session_version}});
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1240,height:1000},colorScheme:'light'});const page=await context.newPage();page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const locale of baseline?['ar']:['ar','en']){
 await context.addCookies([{name:salt,value:token,url:origin,httpOnly:true},{name:'erp_org',value:'a57a738d-2f4e-4ab2-8127-2b3cc330f9b2',url:origin},{name:'locale',value:locale,url:origin}]);
 await page.goto(origin+'/purchases/orders/new',{waitUntil:'networkidle'});const table=page.locator('[data-slot="table"]').first();await table.locator('tbody tr').first().waitFor();
 const head=table.locator('thead tr').first(),row=table.locator('tbody tr').first();const headings=await head.locator('th').allTextContents(),cells=await row.locator('td').count();
 console.log((baseline?'BASELINE':'CHECK')+' '+locale+' headers='+headings.length+' bodyCells='+cells);
 if(baseline){assert.notEqual(headings.length,cells,'Original bug should be observable');await table.screenshot({path:join(out,'before.png')});break;}
 assert.equal(headings.length,cells);assert.equal(cells,12);
 const labels=locale==='ar'?['صورة','الصنف','الوحدة','الكمية','السعر','شحن/وحدة','خصم','الضريبة','الإجمالي']:['Image','Item','Unit','Quantity','Price','Shipping/unit','Discount','Tax','Total'];
 for(const label of labels)assert(headings.some(x=>x.trim()===label),'Missing '+label);
 async function aligned(){const geometry=await table.evaluate(t=>{const h=[...t.querySelectorAll('thead tr:first-child th')].map(c=>c.getBoundingClientRect());const d=[...t.querySelectorAll('tbody tr:first-child td')].map(c=>c.getBoundingClientRect());return h.map((c,i)=>Math.max(Math.abs(c.left-d[i].left),Math.abs(c.width-d[i].width)));});assert(geometry.every(n=>n<1.1),'Header/body alignment');}
 await aligned();await table.evaluate(el=>window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top-250));await page.screenshot({path:join(out,'after-'+locale+'.png')});const container=table.locator('..');await container.evaluate(el=>el.scrollLeft=document.documentElement.dir==='rtl'?-el.scrollWidth:el.scrollWidth);await aligned();
 await page.setViewportSize({width:390,height:900});await aligned();await container.evaluate(el=>el.scrollLeft=0);await page.screenshot({path:join(out,'mobile-'+locale+'.png'),fullPage:true});await page.setViewportSize({width:1240,height:1000});
 console.log('PASS '+locale+' labels, matching columns, horizontal scrolling and mobile alignment');
 if(locale==='en'){
 const {rows:[item]}=await pool.query('select code from items where organization_id=$1 and is_active=true order by code limit 1',['a57a738d-2f4e-4ab2-8127-2b3cc330f9b2']);
 await table.getByPlaceholder('Search by name or code…').fill(item.code);
 await page.getByRole('button').filter({hasText:item.code}).last().click();
 await row.locator('input[type=number]').nth(1).fill('10');
 await page.getByRole('button',{name:'Add a charge or discount',exact:true}).click();
 await page.getByRole('combobox',{name:'Charge type',exact:true}).selectOption('OTHER');
 await page.getByRole('spinbutton',{name:'Charge or discount amount',exact:true}).fill('10');
 await page.getByRole('button',{name:'Allocate',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('thead tr')?.children.length===13);
 assert.equal(await head.locator('th').count(),await row.locator('td').count());await aligned();
 await container.evaluate(el=>el.scrollLeft=0);await container.screenshot({path:join(out,'with-other-charge-en.png')});
 console.log('PASS optional additional-cost column remains aligned (13 headers / 13 cells); form not saved');
 }
 }
 assert.equal(errors.length,0,'Browser errors');
}finally{await browser?.close();await pool.end();}
