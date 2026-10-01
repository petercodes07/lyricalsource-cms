// Isolated, loopback-only demo. Never connects to the live publishing API.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lyricalsource-demo-'));
const token = crypto.randomBytes(32).toString('hex');
const articles = new Map([
  [1, { id: 1, title: 'The stories behind the sound', slug: 'stories-behind-the-sound', excerpt: 'Every great song has a story. This is where we tell it.', body: '<h2>A new chapter</h2><p>Welcome to the LyricalSource editorial workspace. This sample article lives only in the local demo.</p>', author: 'Editorial team', status: 'published', postType: 'news', tags: ['Editorial'], image: '', updatedAt: '2026-10-01' }],
  [2, { id: 2, title: 'Inside the next wave of Afrobeats', slug: 'next-wave-afrobeats', excerpt: 'A draft ready for your ideas.', body: '<p>Start writing your story here.</p>', author: 'Editorial team', status: 'draft', postType: 'blog', tags: ['Afrobeats'], image: '', updatedAt: '2026-10-01' }],
]);
let nextId = 3;
const api = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); return res.end('{}'); }
  if (req.url === '/api/cms/media') { res.writeHead(503); return res.end(JSON.stringify({ error: 'Demo uploads are disabled. Connect a test site API to test media storage.' })); }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const data = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  const id = Number(req.url.split('/').at(-1));
  if (req.method === 'GET' && req.url === '/api/cms/articles') return res.end(JSON.stringify({ articles: [...articles.values()] }));
  if (req.method === 'GET' && articles.has(id)) return res.end(JSON.stringify({ article: articles.get(id) }));
  if (req.method === 'POST' && req.url === '/api/cms/articles') { const id = nextId++; articles.set(id, { ...data, id, updatedAt: new Date().toISOString() }); return res.end(JSON.stringify({ id })); }
  if (req.method === 'PUT' && articles.has(id)) { articles.set(id, { ...data, id, updatedAt: new Date().toISOString() }); return res.end(JSON.stringify({ id })); }
  res.writeHead(404); res.end('{}');
});
api.listen(0, '127.0.0.1', () => {
  Object.assign(process.env, {
    CMS_DEMO_MODE: '1', CMS_ENV_FILE: path.join(temp, 'unused.env'), CMS_DB_PATH: path.join(temp, 'cms.sqlite'),
    CMS_SUPERUSER_EMAIL: 'demo@example.com', CMS_SUPERUSER_PASSWORD: 'local-demo-only-1234',
    SITE_API_URL: `http://127.0.0.1:${api.address().port}`, SITE_PUBLIC_URL: 'http://127.0.0.1:3100',
    CMS_API_TOKEN: token, CMS_BASE_URL: 'http://127.0.0.1:3100', SMTP_HOST: '',
  });
  const app = require('../src/app');
  const server = app.listen(3100, '127.0.0.1', () => console.log('Isolated demo: http://127.0.0.1:3100 — demo@example.com / local-demo-only-1234. Data is temporary; uploads disabled.'));
  const cleanup = () => { server.close(); api.close(); require('../src/store').db.close(); fs.rmSync(temp, { recursive: true, force: true }); process.exit(0); };
  server.on('error', error => { console.error(error.message); cleanup(); });
  process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
});
