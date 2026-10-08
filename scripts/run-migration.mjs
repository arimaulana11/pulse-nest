import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const sql   = readFileSync(resolve(__dir, '../database/migrate-notifications.sql'), 'utf8');

const { Client } = pg;
const c = new Client({
  connectionString: 'postgresql://neondb_owner:npg_cwD3XI5ryUzm@ep-rough-bonus-b5hbztjh-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require'
});
await c.connect();
await c.query(sql);
console.log('✓ migrate-notifications.sql applied');
await c.end();
