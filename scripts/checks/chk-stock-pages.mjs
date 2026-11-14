/** Authenticated read-only smoke for the company affected by digest 613346626. No credentials or page data are printed. */
import assert from 'node:assert/strict';
import pg from 'pg';
import { encode } from 'next-auth/jwt';
const orgId=process.env.STOCK_SMOKE_ORG;
assert(orgId, 'Set STOCK_SMOKE_ORG to the affected company UUID');
const origin=process.env.STOCK_SMOKE_ORIGIN || 'http://127.0.0.1:3001';
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Smoke is restricted to the local deployment');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
 const {rows:[u]}=await pool.query("select id,role,name,session_version from users where role='system_admin' and is_active=true order by created_at limit 1");
 assert(u, 'No active administrator');
 const salt='authjs.session-token';
 const token=await encode({secret:process.env.AUTH_SECRET,salt,maxAge:600,token:{sub:u.id,id:u.id,role:u.role,name:u.name,sv:u.session_version}});
 for(const path of ['/inventory','/inventory/items','/inventory/stock','/inventory/ledger','/inventory/dead-stock','/inventory/transfers/new','/inventory/adjustments/new']) {
  const r=await fetch(origin+path,{redirect:'manual',headers:{cookie:`${salt}=${token}; erp_org=${orgId}; locale=en`},signal:AbortSignal.timeout(45000)});
  const html=(await r.text()).replaceAll('\\', '');
  assert.equal(r.status,200,'HTTP status '+path);
  assert(!html.includes('613346626')&&!/"digest":"[0-9]+"/.test(html)&&!html.includes("Couldn't show this page"), 'Server error in '+path);
  console.log('PASS rendered '+path);
 }
}finally{await pool.end();}

