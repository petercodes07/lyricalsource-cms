const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

test('staff can invite, draft and publish with role checks', async () => {
  const articles = new Map();
  const playlists = new Map();
  const album = { id: 5, slug: 'existing-album', title: 'Existing album', artistName: 'Artist', artistSlug: 'artist', image: 'https://example.com/album.jpg', releaseDate: '2026-01-01', description: 'Description', trackCount: 1, tracks: [{ id: 7, trackNumber: 1, songName: 'Track', artistName: 'Artist' }], qa: [] };
  const song = { id: 7, slug: 'existing-song', title: 'Original title', songName: 'Original name', artistName: 'Artist' };
  let nextId = 1;
  const site = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer test-service-token') { res.statusCode = 401; return res.end('{}'); }
    if (req.url.startsWith('/api/cms/albums')) {
      if (req.method === 'PUT') { Object.assign(album, body); return res.end(JSON.stringify({ id: album.id })); }
      return res.end(JSON.stringify(req.url.includes('id=') ? { album } : { albums: [album], total: 1 }));
    }
    if (req.url.startsWith('/api/cms/playlists')) {
      const slug = new URL(req.url, 'http://localhost').searchParams.get('slug');
      if (req.method === 'GET') return res.end(JSON.stringify(slug ? { playlist: playlists.get(slug) } : { playlists: [...playlists.values()] }));
      const playlist = { ...body, songCount: body.songs.length, songs: body.songs.map(id => ({ ...song, id })) };
      playlists.set(body.slug, playlist);
      return res.end(JSON.stringify({ slug: body.slug }));
    }
    if (req.url.startsWith('/api/cms/songs')) {
      if (req.method === 'GET' && req.url.includes('?')) return res.end(JSON.stringify({ songs: [song] }));
      if (req.method === 'GET') return res.end(JSON.stringify({ song }));
      if (req.method === 'PUT') { Object.assign(song, { title: body.title, songName: body.songName }); return res.end(JSON.stringify({ id: song.id })); }
    }
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
    const avatarPage = await (await fetch(base + '/account', { headers: { cookie: ownerCookie } })).text();
    assert.match(avatarPage, /class="profile-avatar" src="\/avatars\/(sage|coral|indigo|gold|rose|teal).svg"/);
    assert.doesNotMatch(avatarPage, /Change avatar|Save avatar|avatar-grid/);
    assert.match(avatarPage, /Account settings/);
    assert.equal((await post('/account/profile', { name: 'Owner', username: 'cms_owner' }, ownerCookie)).status, 302);
    assert.equal((await post('/account/profile', { name: 'Owner', username: '../invalid' }, ownerCookie)).status, 400);
    assert.equal((await post('/account/profile', { name: 'Anonymous', username: 'anonymous' })).headers.get('location'), '/login');
    const usernameLogin = await post('/login', { email: 'CMS_OWNER', password: 'test-password-1234' });
    assert.ok(usernameLogin.headers.get('set-cookie'));


    assert.equal((await fetch(base + '/songs', { headers: { cookie: ownerCookie } })).status, 200);
    const renamed = await post('/songs/7', { title: 'Renamed title', songName: 'Renamed song' }, ownerCookie);
    assert.equal(renamed.status, 302);
    assert.equal(song.title, 'Renamed title');
    assert.equal(song.songName, 'Renamed song');
    assert.equal(song.slug, 'existing-song');
    assert.equal((await post('/songs/7', { title: '', songName: 'Empty title' }, ownerCookie)).status, 400);
    assert.equal(song.title, 'Renamed title');
    assert.equal((await post('/songs/no-id', { title: 'x', songName: 'x' }, ownerCookie)).status, 400);
    const invite = await post('/team/invites', { email: 'writer@example.com', role: 'author' }, ownerCookie);
    assert.equal(invite.status, 200);
    const html = await invite.text();
    const token = html.match(/\/invite\/([a-f0-9]{64})/)?.[1];
    assert.ok(token);
    const accepted = await post(`/invite/${token}`, { name: 'Writer', username: 'cms_writer', password: '12344321' });
    assert.equal(accepted.status, 302);
    const reuse = await post(`/invite/${token}`, { name: 'Other', password: 'other-password-1234' });
    assert.equal(reuse.status, 410);
    const writerLogin = await post('/login', { email: 'writer@example.com', password: '12344321' });
    const writerCookie = writerLogin.headers.get('set-cookie').split(';')[0];
    const duplicateUsername = await post('/account/profile', { name: 'Writer', username: 'CMS_OWNER' }, writerCookie);
    assert.match(duplicateUsername.headers.get('location'), /Username\+already\+taken/);
    const teamPage = await (await fetch(base + '/team', { headers: { cookie: ownerCookie } })).text();
    assert.match(teamPage, /cms_writer/);
    assert.ok((await post('/login', { email: 'cms_writer', password: '12344321' })).headers.get('set-cookie'));

    assert.equal((await post('/songs/7', { title: 'Author edit', songName: 'Author edit' }, writerCookie)).status, 403);
    assert.equal(song.title, 'Renamed title');
    const anonymousSong = await post('/songs/7', { title: 'Anonymous edit', songName: 'Anonymous edit' });
    assert.equal(anonymousSong.headers.get('location'), '/login');
    const crossOriginSong = await fetch(base + '/songs/7', { method: 'POST', redirect: 'manual', headers: { cookie: ownerCookie, origin: 'https://other.example' } });
    assert.equal(crossOriginSong.status, 403);
    const authorPublish = await post('/articles', { title: 'Test Story', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'publish' }, writerCookie);
    assert.equal(authorPublish.status, 403);
    const draft = await post('/articles', { title: 'Test Story', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'blog', intent: 'draft' }, writerCookie);
    assert.equal(draft.status, 302);
    assert.equal(articles.get(1).status, 'draft');
    assert.equal(articles.get(1).postType, 'blog');
    const draftPage = await (await fetch(base + '/articles/1', { headers: { cookie: writerCookie } })).text();
    const previewHref = draftPage.match(/href="([^"]+)"[^>]*>View page on website/)?.[1];
    assert.ok(previewHref);
    assert.match(draftPage, /<form data-editor-form[\s\S]*View page on website[\s\S]*?<\/form>/);
    assert.doesNotMatch(draftPage, /Preview saved version/);
    const listPage = await (await fetch(base + '/', { headers: { cookie: writerCookie } })).text();
    assert.doesNotMatch(listPage, /View page on website|Preview saved version/);
    assert.match(listPage, /Showing 1 of 1 articles/);
    assert.match(listPage, /aria-label="Edit Test Story"/);
    const hiddenDrafts = await (await fetch(base + '/?status=published', { headers: { cookie: writerCookie } })).text();
    assert.match(hiddenDrafts, /Showing 0 of 1 articles/);
    assert.doesNotMatch(hiddenDrafts, /class="story-title"/);
    const searched = await (await fetch(base + '/?q=test&type=blog&status=draft', { headers: { cookie: writerCookie } })).text();
    assert.match(searched, /Showing 1 of 1 articles/);
    const noMatch = await (await fetch(base + '/?q=nonexistent&type=news', { headers: { cookie: writerCookie } })).text();
    assert.match(noMatch, /No matching articles/);
    assert.doesNotMatch(noMatch, /class="story-title"/);


    const previewUrl = new URL(previewHref.replaceAll('&amp;', '&'));
    assert.equal(previewUrl.pathname, '/articles/test-story');
    const expires = previewUrl.searchParams.get('preview');
    assert.ok(Number(expires) > Date.now() / 1000);
    const expectedSignature = require('node:crypto').createHmac('sha256', 'test-service-token')
      .update(`article-preview:test-story:${expires}`).digest('hex');
    assert.equal(previewUrl.searchParams.get('signature'), expectedSignature);
    assert.equal(articles.get(1).status, 'draft');

    const publish = await post('/articles/1', { title: 'Test Story', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'publish' }, ownerCookie);
    assert.equal(publish.status, 302);
    assert.equal(articles.get(1).status, 'published');
    const authorEditPublished = await post('/articles/1', { title: 'Changed', slug: 'test-story', body: '<p>Story</p>', excerpt: 'Summary', author: 'Writer', postType: 'news', intent: 'draft' }, writerCookie);
    assert.equal(authorEditPublished.status, 403);
    // Both the new Save and older open forms must preserve publication.
    const edit = { title: 'Updated story', slug: 'test-story', body: '<p>Updated</p>', excerpt: 'Summary', author: 'Writer', postType: 'news' };
    for (const intent of ['save', 'draft']) {
      const saved = await post('/articles/1', { ...edit, intent }, ownerCookie);
      assert.equal(saved.status, 302);
      assert.equal(articles.get(1).status, 'published');
      assert.equal(articles.get(1).title, 'Updated story');
    }
    const editPage = await (await fetch(base + '/articles/1', { headers: { cookie: ownerCookie } })).text();
    assert.match(editPage, /Save changes/);
    assert.match(editPage, /Unpublish article/);
    assert.equal((await post('/articles/1/unpublish', {}, writerCookie)).status, 403);
    assert.equal(articles.get(1).status, 'published');
    const crossOrigin = await fetch(base + '/articles/1/unpublish', { method: 'POST', redirect: 'manual', headers: { cookie: ownerCookie, origin: 'https://other.example' } });
    assert.equal(crossOrigin.status, 403);
    const unpublished = await post('/articles/1/unpublish', {}, ownerCookie);
    assert.equal(unpublished.status, 302);
    assert.equal(articles.get(1).status, 'draft');
    assert.equal(articles.get(1).body, '<p>Updated</p>');
    assert.equal((await post('/articles/1', { ...edit, intent: 'save' }, writerCookie)).status, 302);
    assert.equal(articles.get(1).status, 'draft');
    assert.equal((await post('/articles/1', { ...edit, intent: 'delete' }, ownerCookie)).status, 400);
    const anonymous = await post('/articles/1/unpublish', {});
    assert.equal(anonymous.headers.get('location'), '/login');
    const manifestResponse = await fetch(base + '/manifest.webmanifest');
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) {
      const image = Buffer.from(await (await fetch(base + icon.src)).arrayBuffer());
      assert.equal(image.subarray(1, 4).toString(), 'PNG');
      assert.equal(image.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    }
    const install = await fetch(base + '/install');
    assert.equal(install.status, 200);
    assert.match(await install.text(), /manifest.webmanifest/);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    const privatePage = await fetch(base + '/', { headers: { cookie: ownerCookie } });
    assert.equal(privatePage.headers.get('cache-control'), 'no-store');
    assert.ok(!(await privatePage.text()).includes('test-service-token'));
    for (const postType of ['album', 'playlist']) {
      const saved = await post('/articles', { title: `Test ${postType}`, slug: `test-${postType}`, body: '<p>Music story</p>', excerpt: 'Summary', author: 'Owner', postType, intent: 'draft' }, ownerCookie);
      assert.equal(saved.status, 302);
      const created = [...articles.values()].find(article => article.slug === `test-${postType}`);
      assert.equal(created.postType, postType);
      const filtered = await fetch(base + `/?type=${postType}`, { headers: { cookie: ownerCookie }, redirect: 'manual' });
      assert.equal(filtered.headers.get('location'), postType === 'album' ? '/albums' : '/playlists');
      const editor = await (await fetch(base + `/articles/${created.id}`, { headers: { cookie: ownerCookie } })).text();
      assert.match(editor, new RegExp(`value="${postType}" selected`));
    }
    const albumList = await (await fetch(base + '/albums', { headers: { cookie: ownerCookie } })).text();
    assert.match(albumList, /https:\/\/example.com\/album.jpg/);
    assert.match(albumList, /aria-label="Edit Existing album"/);
    assert.doesNotMatch(albumList, /New album/);
    const albumEditor = await (await fetch(base + '/albums/5', { headers: { cookie: ownerCookie } })).text();
    assert.match(albumEditor, /Track list \(1\)/);
    assert.match(albumEditor, /name="artistName"/);
    assert.match(albumEditor, /aria-label="Edit Track"/);
    const albumSave = await post('/albums/5', { title: 'Updated album', artistName: 'Artist', artistSlug: 'artist', releaseDate: '2026-01-01', image: album.image, description: 'Updated description' }, ownerCookie);
    assert.equal(albumSave.status, 302);
    assert.equal(album.title, 'Updated album');
    assert.equal(album.tracks.length, 1);
    assert.equal((await post('/albums/5', { title: 'Forbidden' }, writerCookie)).status, 403);
    const newPlaylist = await (await fetch(base + '/playlists/new', { headers: { cookie: ownerCookie } })).text();
    assert.match(newPlaylist, /Find songs/);
    assert.match(newPlaylist, /data-selected-songs/);
    assert.equal((await post('/playlists/new', { name: 'Collection', slug: 'collection' }, ownerCookie)).status, 400);
    assert.equal((await post('/playlists/new', { name: 'Collection', slug: 'collection', songIds: '7' }, writerCookie)).status, 403);
    const playlistSave = await post('/playlists/new', { name: 'Collection', slug: 'collection', description: 'Great songs', songIds: '7' }, ownerCookie);
    assert.equal(playlistSave.status, 302);
    assert.equal(playlists.get('collection').songCount, 1);
    const playlistPage = await (await fetch(base + '/playlists/collection', { headers: { cookie: ownerCookie } })).text();
    assert.match(playlistPage, /View playlist on website/);
    assert.match(playlistPage, /name="songIds" value="7"/);
    const playlistUpdate = await post('/playlists/collection', { name: 'Updated collection', description: 'Updated', songIds: '7' }, ownerCookie);
    assert.equal(playlistUpdate.status, 302);
    assert.equal(playlists.get('collection').name, 'Updated collection');
    assert.equal((await post('/playlists/new', { name: 'Collection', slug: 'collection', songIds: '7' })).headers.get('location'), '/login');
    const accountHtml = await (await fetch(base + '/account', { headers: { cookie: ownerCookie } })).text();
    assert.doesNotMatch(accountHtml, /12\+ characters|minlength="12"/);
    const blankPassword = await post('/account', { current: 'test-password-1234', password: '' }, ownerCookie);
    assert.match(blankPassword.headers.get('location'), /Enter\+a\+new\+password/);
    const wrongCurrent = await post('/account', { current: 'incorrect', password: '12344321' }, ownerCookie);
    assert.match(wrongCurrent.headers.get('location'), /Current\+password\+is\+incorrect/);
    const shortPassword = await post('/account', { current: 'test-password-1234', password: '12344321' }, ownerCookie);
    assert.match(shortPassword.headers.get('location'), /Password\+changed/);
    assert.ok((await post('/login', { email: 'cms_owner', password: '12344321' })).headers.get('set-cookie'));
    const teamDenied = await fetch(base + '/team', { headers: { cookie: writerCookie }, redirect: 'manual' });
    assert.equal(teamDenied.status, 403);
  } finally {
    await new Promise(resolve => cms.close(resolve));
    await new Promise(resolve => site.close(resolve));
    require('../src/store').db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
