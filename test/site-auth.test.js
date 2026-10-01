const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

test('CMS login checks the LyricalSource site and local staff membership', async () => {
  const site = http.createServer(async (req, res) => {
    if (req.url !== '/api/auth/login') return res.writeHead(404).end();
    let body = '';
    for await (const chunk of req) body += chunk;
    const credentials = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    if (!((credentials.email === 'owner@example.com' && credentials.password === 'site-password-1234') ||
      (credentials.email === 'writer@example.com' && credentials.password === 'writer-site-password-1234'))) {
      return res.writeHead(401).end(JSON.stringify({ error: 'Invalid email or password' }));
    }
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-cms-site-auth-'));
  process.env.CMS_DB_PATH = path.join(temp, 'cms.sqlite');
  process.env.CMS_AUTH_PROVIDER = 'site';
  process.env.CMS_SUPERUSER_EMAIL = 'owner@example.com';
  delete process.env.CMS_SUPERUSER_PASSWORD;
  process.env.SITE_API_URL = `http://127.0.0.1:${site.address().port}`;
  process.env.CMS_API_TOKEN = 'test-service-token';
  const app = require('../src/app');
  const cms = app.listen(0, '127.0.0.1');
  await new Promise(resolve => cms.once('listening', resolve));
  const base = `http://127.0.0.1:${cms.address().port}`;
  process.env.CMS_BASE_URL = base;
  const post = (route, values, cookie = '') => fetch(base + route, {
    method: 'POST', redirect: 'manual',
    headers: { origin: base, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  try {
    const local = await post('/login', { email: 'owner@example.com', password: 'local-demo-only-1234' });
    assert.equal(local.headers.get('set-cookie'), null);
    const missing = await post('/login', { email: 'other@example.com', password: 'site-password-1234' });
    assert.equal(missing.headers.get('set-cookie'), null);
    const valid = await post('/login', { email: 'owner@example.com', password: 'site-password-1234' });
    assert.equal(valid.status, 302);
    const cookie = valid.headers.get('set-cookie').split(';')[0];
    const account = await fetch(base + '/account', { headers: { cookie } });
    assert.equal(account.status, 200);
    assert.match(await account.text(), /managed by your LyricalSource site account/);
    const change = await post('/account', { current: 'site-password-1234', password: 'new-password-1234' }, cookie);
    assert.equal(change.status, 403);
    const invited = await post('/team/invites', { email: 'writer@example.com', role: 'author' }, cookie);
    assert.equal(invited.status, 200);
    const invitation = (await invited.text()).match(/\/invite\/([a-f0-9]{64})/)?.[1];
    assert.ok(invitation);
    const accepted = await post(`/invite/${invitation}`, { name: 'Writer' });
    assert.equal(accepted.status, 302);
    const writer = await post('/login', { email: 'writer@example.com', password: 'writer-site-password-1234' });
    assert.equal(writer.status, 302);
    assert.ok(writer.headers.get('set-cookie'));
  } finally {
    await new Promise(resolve => cms.close(resolve));
    await new Promise(resolve => site.close(resolve));
    require('../src/store').db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
