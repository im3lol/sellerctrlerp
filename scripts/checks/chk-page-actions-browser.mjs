/** Read-only top action layout checks; never submits business forms. */
import assert from 'node:assert/strict';
import pg from 'pg';
import { encode } from 'next-auth/jwt';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const origin='http://127.0.0.1:3001',out='.ops-data/page-actions-20261024';
await mkdir(out,{recursive:true});
const {chromium}=createRequire(join(process.env.MCP_QA_PACKAGES,'package.json'))('playwright');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});let browser;
try {
 const {rows:[u]}=await pool.query("select id,name,role,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
 const salt='authjs.session-token';const token=await encode({secret:process.env.AUTH_SECRET,salt,maxAge:1800,token:{sub:u.id,id:u.id,name:u.name,role:u.role,sv:u.session_version}});
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({timezoneId:'Africa/Cairo'});
 await ctx.addCookies([{name:salt,value:token,url:origin,httpOnly:true},{name:'erp_org',value:'a57a738d-2f4e-4ab2-8127-2b3cc330f9b2',url:origin},{name:'nav_collapsed',value:'0',url:origin}]);
 const p=await ctx.newPage();p.setDefaultTimeout(30000);const errors=[],checks=[];p.on('pageerror',e=>errors.push(e.message));
 const routes=['/inventory/items/P-00955/edit','/inventory/items/new','/purchases/orders/new','/sales/orders/new','/inventory/transfers/new','/inventory/adjustments/new','/accounting/journal/new','/accounting/expenses/new','/sales/receipts/new','/settings/organization','/settings/numbering','/settings/printing','/accounting/assets/new','/accounting/banks/new'];
 for(const mode of [{locale:'ar',width:1280,height:950},{locale:'ar',width:390,height:850},{locale:'en',width:390,height:850}]){
 await ctx.addCookies([{name:'locale',value:mode.locale,url:origin}]);await p.setViewportSize({width:mode.width,height:mode.height});
 for(const route of routes){
  await p.goto(origin+route,{waitUntil:'networkidle'});await p.locator('main [data-page-actions]').first().waitFor({state:'visible'});
  const before=await p.locator('main [data-page-actions]').first().evaluate(el=>{const b=el.getBoundingClientRect();const fields=[...el.closest('main').querySelectorAll('input:not([type=hidden]),textarea,select')].filter(x=>x.getBoundingClientRect().height>0&&!el.contains(x));return {top:b.top,bottom:b.bottom,firstField:fields[0]?.getBoundingClientRect().top,owners:[...el.querySelectorAll('button[type=submit]')].map(b=>!!b.form),buttons:el.querySelectorAll('button').length};});
  assert(before.buttons>0,route+' actions missing');assert(before.top>=63&&before.top<mode.height-60,route+' actions initially outside viewport '+JSON.stringify(before));
  if(before.firstField!==undefined)assert(before.bottom<=before.firstField+2,route+' actions below fields '+JSON.stringify(before));
  assert(before.owners.every(Boolean),route+' native submit lost its form');
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert(!overflow,route+' horizontal viewport overflow');
  if(route.includes('items/P-00955')||route==='/settings/organization'){
   await p.evaluate(()=>window.scrollTo(0,450));await p.waitForTimeout(150);
   const r=await p.locator('main [data-page-actions]').first().boundingBox();assert(r&&r.y>=63&&r.y<90,route+' sticky bar '+JSON.stringify(r));
   await p.screenshot({path:join(out,`${mode.locale}-${mode.width}-${route.includes('items/')?'item':'settings'}.png`)});
  }
  checks.push({route,...mode,...before});
 }
 }
 assert.equal(errors.length,0,errors.join('\n'));await writeFile(join(out,'browser.json'),JSON.stringify({checks,errors,readOnly:true},null,2));console.log('PASS '+checks.length+' page/locale/viewport checks, sticky scroll, native form ownership, zero overflow and browser errors. No forms submitted.');
}finally{await browser?.close();await pool.end();}
