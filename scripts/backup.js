require('dotenv').config({ path: process.env.CMS_ENV_FILE || '.env.local', quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
(async () => {
  const source = path.resolve(process.env.CMS_DB_PATH || './data/cms.sqlite');
  const destination = process.argv[2] && path.resolve(process.argv[2]);
  if (!destination || destination === source) throw new Error('Usage: npm run backup -- /secure/path/new-backup.sqlite');
  // Reserve a new destination so an existing backup can never be overwritten.
  const handle = fs.openSync(destination, 'wx', 0o600); fs.closeSync(handle);
  let db;
  try {
    db = new Database(source, { readonly: true, fileMustExist: true });
    await db.backup(destination);
    const check = new Database(destination, { readonly: true });
    try { if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed'); }
    finally { check.close(); }
    console.log(`Verified SQLite backup: ${destination}`);
  } catch (error) { fs.unlinkSync(destination); throw error; }
  finally { db?.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
