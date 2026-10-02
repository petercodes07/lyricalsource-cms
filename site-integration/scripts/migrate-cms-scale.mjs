// Run from the website checkout on Node 22+. No credentials are printed.
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2';
process.loadEnvFile('.env.local');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/migrate-cms-scale.mjs /private/new-backup-directory [ownership.json]');
fs.mkdirSync(destination, { mode: 0o700 });
const conn = mysql.createConnection({ host:process.env.DB_HOST||'localhost',socketPath:process.env.DB_SOCKET||undefined,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME });
const db = conn.promise();
const tables = ['articles','article_tags','cms_audit','songs','albums','playlists','playlist_songs'];
try {
  await db.query('SET SESSION lock_wait_timeout=10');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  for (const table of tables) {
    const [schema] = await db.query(`SHOW CREATE TABLE \`${table}\``);
    fs.writeFileSync(path.join(destination,table+'.schema.json'),JSON.stringify(schema),{mode:0o600,flag:'wx'});
    const output=fs.createWriteStream(path.join(destination,table+'.ndjson'),{mode:0o600,flags:'wx'});
    let count=0;
    for await (const row of conn.query(`SELECT * FROM \`${table}\``).stream()) {
      if (!output.write(JSON.stringify(row)+'\n')) await new Promise((resolve,reject)=>{const done=()=>{output.off('error',fail);resolve();};const fail=error=>{output.off('drain',done);reject(error);};output.once('drain',done);output.once('error',fail);});
      count++;
    }
    await new Promise((resolve,reject)=>{output.end(resolve);output.once('error',reject);});
    console.log(`Backed up ${table}: ${count} rows`);
  }
  await db.commit();
  async function column(table,name,definition) {
    const [rows]=await db.query('SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',[table,name]);
    if (!rows.length) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
  }
  async function index(table,name,columns) {
    const [rows]=await db.query('SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?',[table,name]);
    if (!rows.length) await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns})`);
  }
  for(const table of ['articles','songs','albums','playlists']) await column(table,'edit_version','INT UNSIGNED NOT NULL DEFAULT 1');
  await column('articles','cms_owner_id','BIGINT UNSIGNED NULL');
  await index('articles','idx_cms_status_updated','status,updated_at,id');
  await index('articles','idx_cms_owner_updated','cms_owner_id,status,updated_at,id');
  await index('albums','idx_cms_album_date','release_date,id');
  await index('playlist_songs','idx_cms_playlist_position','playlist_slug,position');
  if(process.argv[3]) {
    const owners=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
    for(const owner of owners) {
      if(!Number.isSafeInteger(owner.article_id)||!Number.isSafeInteger(owner.user_id))throw new Error('Invalid ownership mapping');
      await db.execute('UPDATE articles SET cms_owner_id=?,updated_at=updated_at WHERE id=? AND cms_owner_id IS NULL',[owner.user_id,owner.article_id]);
    }
    console.log(`Restored ${owners.length} author ownership mappings`);
  }
  fs.writeFileSync(path.join(destination,'completed.json'),JSON.stringify({completedAt:new Date().toISOString(),tables}),{mode:0o600,flag:'wx'});
  console.log('CMS version and index migration complete');
} catch(error) { await db.rollback().catch(()=>{}); throw error; }
finally { await db.end(); }
