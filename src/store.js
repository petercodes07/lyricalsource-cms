const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const file = path.resolve(process.env.CMS_DB_PATH || './data/cms.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
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
function bootstrap() {
  const email = process.env.CMS_SUPERUSER_EMAIL?.toLowerCase().trim();
  const password = process.env.CMS_SUPERUSER_PASSWORD;
  if (!email || !password) return;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(email, 'Superuser', hashPassword(password), 'superuser');
}
bootstrap();
module.exports = { db, digest, hashPassword, verifyPassword };
