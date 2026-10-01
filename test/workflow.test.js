const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

test('staff can invite, draft and publish with role checks', async () => {
  const articles = new Map();
  let nextId = 1;
  const site = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-service-token') { res.statusCode = 401; return res.end('{}'); }
    const id = Number(req.url.split('/').at(-1));
    if (req.method === 'GET' && req.url === '/api/cms/articles') return res.end(JSON.stringify({ articles: [...articles.values()] }));
    if (req.method === 'POST' && req.url === '/api/cms/articles') {
      const article = { ...body, id: nextId++ }; articles.set(article.id, article);
      res.statusCode = 201; return res.end(JSON.stringify({ id: article.id, slug: article.slug }));
    }
    if (req.method === 'GET' && articles.has(id)) return res.end(JSON.stringify({ article: articles.get(id) }));
    if (req.method === 'PUT' && articles.has(id)) {
      const article = { ...body, id }; articles.set(id, article); return res.end(JSON.stringify({ id, slug: article.slug }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-cms-test-'));
  process.env.CMS_DB_PATH = path.join(temp, 'cms.sqlite');
  process.env.CMS_SUPERUSER_EMAIL = 'test-owner@example.com';
  process.env.CMS_SUPERUSER_PASSWORD = 'test-password-1234';
  process.env.SITE_API_URL = `http://127.0.0.1:${site.address().port}`;
  process.env.SITE_PUBLIC_URL = process.env.SITE_API_URL;
  process.env.CMS_API_TOKEN = 'test-service-token';
  const app = require('../src/app');
  const cms = app.listen(0, '127.0.0.1');
  await new Promise(resolve => cms.once('listening', resolve));
  const base = `http://127.0.0.1:${cms.address().port}`;
  process.env.CMS_BASE_URL = base;
  async function post(route, values, cookie = '') {
    return fetch(base + route, { method: 'POST', redirect: 'manual', headers: { origin: base, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  }
  try {
    const login = await post('/login', { email: 'test-owner@example.com', password: 'test-password-1234' });
    assert.equal(login.status, 302);
    const ownerCookie = login.headers.get('set-cookie').split(';')[0];
    const invite = await post('/team/invites', { email: 'writer@example.com', role: 'author' }, ownerCookie);
    assert.equal(invite.status, 200);
    const html = await invite.text();
    const token = html.match(/\/invite\/([a-f0-9]{64})/)?.[1];
    assert.ok(token);
    const accepted = await post(`/invite/${token}`, { name: 'Writer', password: 'writer-password-1234' });
    assert.equal(accepted.status, 302);
    const reuse = await post(`/invite/${token}`, { name: 'Other', password: 'other-password-1234' });
    assert.equal(reuse.status, 410);
    const writerLogin = await post('/login', { email: 'writer@example.com', password: 'writer-password-1234' });
    const writerCookie = writerLogin.headers.get('set-cookie').split(';')[0];
    const authorPublish = await post('/articles', { title: 'Test Story', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'publish' }, writerCookie);
    assert.equal(authorPublish.status, 403);
    const draft = await post('/articles', { title: 'Test Story', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'draft' }, writerCookie);
    assert.equal(draft.status, 302);
    assert.equal(articles.get(1).status, 'draft');
    const publish = await post('/articles/1', { title: 'Test Story', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'publish' }, ownerCookie);
    assert.equal(publish.status, 302);
    assert.equal(articles.get(1).status, 'published');
    const authorEditPublished = await post('/articles/1', { title: 'Changed', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'draft' }, writerCookie);
    assert.equal(authorEditPublished.status, 403);
    const teamDenied = await fetch(base + '/team', { headers: { cookie: writerCookie }, redirect: 'manual' });
    assert.equal(teamDenied.status, 403);
  } finally {
    await new Promise(resolve => cms.close(resolve));
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
