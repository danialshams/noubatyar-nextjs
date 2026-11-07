import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DIRECT_URL||process.env.DATABASE_URL;
if(!url)throw new Error('DIRECT_URL/DATABASE_URL is required');
const client=new pg.Client({connectionString:url});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(await fs.readFile('prisma/extra-constraints.sql','utf8'));
  await client.query('COMMIT');
  console.log('PostgreSQL constraints and booking triggers applied successfully.');
}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
