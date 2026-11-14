// Read-only audit against the migrated companies; no fixtures or business writes.
import pg from 'pg';
const owner=new pg.Pool({connectionString:process.env.MIGRATE_DATABASE_URL});
const app=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await app.connect();
try {
  const role=(await client.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
  if(role.rolsuper||role.rolbypassrls)throw new Error('Application role bypasses isolation');
  const orgs=(await owner.query('select id from organizations order by id')).rows;
  let probes=0;
  for(const table of ['items','customers','journal_entries']) {
    const none=(await client.query(`select count(*)::int n from ${table}`)).rows[0].n;
    if(none!==0)throw new Error(`${table}: rows visible without tenant scope`);
    probes++;
    for(const org of orgs) {
      const expected=(await owner.query(`select count(*)::int n from ${table} where organization_id=$1`,[org.id])).rows[0].n;
      await client.query('begin read only');
      await client.query("select set_config('app.current_org',$1,true),set_config('app.is_platform_admin','off',true)",[org.id]);
      const {rows}=await client.query(`select count(*)::int n,count(*) filter(where organization_id<>$1)::int foreign_rows from ${table}`,[org.id]);
      if(rows[0].n!==expected||rows[0].foreign_rows!==0)throw new Error(`${table}: incorrect company isolation`);
      await client.query('rollback');probes++;
    }
  }
  console.log(`PASS tenant isolation: ${orgs.length} migrated companies, ${probes} read probes, non-superuser/NOBYPASSRLS app role.`);
}finally{client.release();await app.end();await owner.end();}
