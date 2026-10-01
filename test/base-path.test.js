const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('CMS behind /cms keeps forms, redirects, assets and manifest in scope', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-prefix-test-'));
  const site = http.createServer((req, res) => { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ articles: [] })); });
  await new Promise(resolve => site.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env, { CMS_DB_PATH: path.join(temp,'cms.sqlite'), CMS_BASE_URL: 'https://lyricalsource.com/cms', SITE_API_URL: `http://127.0.0.1:${site.address().port}`, CMS_API_TOKEN: 'isolated-test-token', CMS_SUPERUSER_EMAIL: 'prefix-test@example.com', CMS_SUPERUSER_PASSWORD: 'isolated-test-password' });
  delete process.env.CMS_AUTH_PROVIDER;
  const app = require('../src/app'); const cms = app.listen(0,'127.0.0.1');
  await new Promise(resolve => cms.once('listening',resolve));
  const base = `http://127.0.0.1:${cms.address().port}`;
  try {
    const prefixedLogin = await fetch(base+'/cms/login');
    assert.equal(prefixedLogin.status,200);
    assert.equal((await fetch(base+'/cms/app.css')).status,200);
    const protectedPage = await fetch(base+'/cms/', { redirect: 'manual' });
    assert.equal(protectedPage.headers.get('location'),'/cms/login');
    const html = await (await fetch(base+'/login')).text();
    assert.match(html, /action="\/cms\/login"/); assert.match(html, /href="\/cms\/app.css"/);
    const login = await fetch(base+'/login', { method: 'POST', redirect: 'manual', headers: { origin: 'https://lyricalsource.com', 'content-type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email:'prefix-test@example.com', password:'isolated-test-password' }) });
    assert.equal(login.status,302); assert.equal(login.headers.get('location'),'/cms/');
    assert.match(login.headers.get('set-cookie'), /Secure/);
    const manifest = await (await fetch(base+'/manifest.webmanifest')).json();
    assert.equal(manifest.scope,'/cms/'); assert.equal(manifest.start_url,'/cms/');
    assert.equal(manifest.icons[0].src,'/cms/icons/icon-192.png');
    const anonymous = await fetch(base+'/songs',{redirect:'manual'}); assert.equal(anonymous.headers.get('location'),'/cms/login');
  } finally { await new Promise(resolve => cms.close(resolve)); await new Promise(resolve => site.close(resolve)); require('../src/store').db.close(); fs.rmSync(temp,{recursive:true,force:true}); }
});
