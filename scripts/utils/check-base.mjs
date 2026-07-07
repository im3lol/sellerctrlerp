import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const orphans = await pool.query("select count(*)::int c from products where base_id is null");
const missingName = await pool.query("select count(*)::int c from product_bases where name is null or name = ''");
const total = await pool.query("select count(*)::int c from products");
const bases = await pool.query("select count(*)::int c from product_bases");
console.log("products total:", total.rows[0].c);
console.log("product_bases total:", bases.rows[0].c);
console.log("products without base_id:", orphans.rows[0].c);
console.log("bases missing name:", missingName.rows[0].c);
await pool.end();
