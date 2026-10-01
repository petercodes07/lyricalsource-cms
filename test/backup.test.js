const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
test('backup preserves live WAL data and refuses overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-backup-test-'));
  const source = path.join(dir, 'source.sqlite');
  const destination = path.join(dir, 'backup.sqlite');
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'retained\')');
    const run = () => spawnSync(process.execPath, ['scripts/backup.js', destination], { encoding: 'utf8', env: { ...process.env, CMS_ENV_FILE: path.join(dir, 'none'), CMS_DB_PATH: source } });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const copy = new Database(destination, { readonly: true });
    try { assert.equal(copy.prepare('SELECT value FROM sample').get().value, 'retained'); }
    finally { copy.close(); }
    assert.notEqual(run().status, 0);
    assert.equal(db.prepare('SELECT value FROM sample').get().value, 'retained');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
