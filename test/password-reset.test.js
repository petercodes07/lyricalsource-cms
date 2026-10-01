const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
test('reset tokens expire, cannot be reused, and revoke existing sessions', async () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER,password_hash TEXT); CREATE TABLE sessions(user_id INTEGER); INSERT INTO users VALUES(1,'staff@example.com',1,'old'); INSERT INTO sessions VALUES(1)");
  const app = express(); app.use(express.urlencoded({ extended: false }));
  process.env.SMTP_HOST = 'test'; process.env.CMS_AUTH_PROVIDER = 'local';
  let email;
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  require('../src/password-reset')(app, { db, digest, hashPassword: p => 'hashed:' + p, sendMail: async (_to, _subject, text) => { email = text; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, values) => fetch(base + route, { method: 'POST', redirect: 'manual', body: new URLSearchParams(values) });
  try {
    const known = await post('/forgot-password', { email: 'staff@example.com' });
    const unknown = await post('/forgot-password', { email: 'unknown@example.com' });
    assert.equal(known.headers.get('location'), unknown.headers.get('location'));
    const token = email.match(/reset-password\/([a-f0-9]{64})/)[1];
    assert.equal((await post('/reset-password/' + token, { password: 'short' })).status, 400);
    assert.equal((await post('/reset-password/' + token, { password: 'new-password-1234' })).status, 302);
    assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash, 'hashed:new-password-1234');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal((await post('/reset-password/' + token, { password: 'another-password' })).status, 410);
    await post('/forgot-password', { email: 'staff@example.com' });
    const expired = email.match(/reset-password\/([a-f0-9]{64})/)[1];
    db.prepare('UPDATE password_resets SET expires_at=0').run();
    assert.equal((await fetch(base + '/reset-password/' + expired)).status, 410);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
