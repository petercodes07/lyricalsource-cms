const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { promisify } = require('node:util');
const { createLimit } = require('./resource-limit');
const scrypt = promisify(crypto.scrypt);
const passwordWork = createLimit(2, 32);

const file = path.resolve(process.env.CMS_DB_PATH || './data/cms.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 2000');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('superuser','owner','editor','author')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, invited_by INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL, accepted_at INTEGER, revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS article_owners (
  article_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id)
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS article_owners_user ON article_owners(user_id, article_id);
CREATE TABLE IF NOT EXISTS edit_presence (
  resource TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, PRIMARY KEY(resource,user_id)
);
CREATE INDEX IF NOT EXISTS edit_presence_expiry ON edit_presence(expires_at);
CREATE INDEX IF NOT EXISTS edit_presence_user ON edit_presence(user_id);
`);
function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
  db.prepare('DELETE FROM edit_presence WHERE expires_at<=?').run(now);
}
cleanup();
setInterval(cleanup, 60000).unref();

// Add avatar choices without replacing existing staff records.
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'avatar')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'sage'");
}

// Stable staff usernames; existing accounts keep their email and password.
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'username')) {
  db.exec('ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username COLLATE NOCASE)');
function assignUsernames() {
  db.transaction(() => {
    for (const user of db.prepare('SELECT id FROM users WHERE username IS NULL').all()) {
      let username = `staff${user.id}`;
      while (db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(username)) username += '_';
      db.prepare('UPDATE users SET username=? WHERE id=?').run(username, user.id);
    }
  })();
}

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const a = Buffer.from(hash, 'hex');
    const b = crypto.scryptSync(password, salt, a.length);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
async function hashPasswordAsync(password) {
  return passwordWork(async () => {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
  });
}
async function verifyPasswordAsync(password, stored) {
  return passwordWork(async () => {
    try {
      const [salt, hash] = stored.split(':');
      const a = Buffer.from(hash, 'hex');
      if (a.length !== 64) return false;
      const b = await scrypt(password, salt, 64);
      return crypto.timingSafeEqual(a, b);
    } catch { return false; }
  });
}
function bootstrap() {
  const email = process.env.CMS_SUPERUSER_EMAIL?.toLowerCase().trim();
  const password = process.env.CMS_AUTH_PROVIDER === 'site' ? crypto.randomBytes(32).toString('hex') : process.env.CMS_SUPERUSER_PASSWORD;
  if (!email || !password) return;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(email, 'Superuser', hashPassword(password), 'superuser');
}
bootstrap();
assignUsernames();
module.exports = { db, digest, hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync };
