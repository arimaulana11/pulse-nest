import pg from 'pg';
const { Client } = pg;
const c = new Client({
  connectionString: 'postgresql://neondb_owner:npg_cwD3XI5ryUzm@ep-rough-bonus-b5hbztjh-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require'
});
await c.connect();
const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
console.log('Tables:', r.rows.map(x => x.table_name).join(', '));
await c.end();
