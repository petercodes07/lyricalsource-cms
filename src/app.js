require('dotenv').config({ path: process.env.CMS_ENV_FILE || '.env.local', quiet: true });
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const sanitizeHtml = require('sanitize-html');
const { db, digest, hashPassword, verifyPassword } = require('./store');
const { request, authenticate } = require('./site-api');
const { escape: e, layout, cmsUrl } = require('./views');

const app = express();
app.disable('x-powered-by');
// Support the shared /cms address as well as requests stripped by its proxy.
const cmsPath = new URL(process.env.CMS_BASE_URL || 'http://127.0.0.1:3100').pathname.replace(/\/$/, '');
app.use((req, res, next) => {
  if (cmsPath && (req.url === cmsPath || req.url.startsWith(cmsPath + '/') || req.url.startsWith(cmsPath + '?'))) req.url = req.url.slice(cmsPath.length) || '/';
  if (req.url.startsWith('?')) req.url = '/' + req.url;
  next();
});
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; form-action 'self'; base-uri 'self'");
  if (req.method === 'POST') {
    const origin = req.get('origin');
    const expected = new URL(process.env.CMS_BASE_URL || `http://${req.get('host')}`).origin;
    if (origin && origin !== expected) return res.status(403).send('Invalid request origin');
  }
  const raw = /(?:^|;\s*)cms_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (raw) {
    req.user = db.prepare(`SELECT u.id, u.email, u.name, u.username, u.role, u.avatar FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digest(raw), Date.now());
  }
  next();
});
app.get('/manifest.webmanifest', (req, res) => {
  const manifest = require('../public/manifest.webmanifest.json');
  res.json({ ...manifest, id: cmsUrl('/'), start_url: cmsUrl('/'), scope: cmsUrl('/'), icons: manifest.icons.map(icon => ({ ...icon, src: cmsUrl(icon.src) })) });
});
app.use(express.static(path.join(__dirname, '../public'), { index: false, dotfiles: 'deny' }));
app.get('/install', (req, res) => res.send(layout('Install', req.user, `<p class="eyebrow">YOUR WORKSPACE, ANYWHERE</p><h1>Make room for your next story.</h1><p class="lead">Install LyricalSource CMS on your computer for quick access to your team's shared workspace.</p><div class="card"><h2>Install the app</h2><button data-install hidden>Install LyricalSource CMS</button><p data-install-help>In Chrome or Edge, use the install option in the address bar or browser menu. On supported macOS Safari versions, choose File → Add to Dock.</p><p>Installation depends on your browser. You can always use this workspace in a browser on Windows, macOS or Linux.</p><p>Keep an internet connection while saving, uploading and publishing. Your team sees the same shared content.</p><a href="/">Open workspace →</a></div>`)));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const randomToken = () => crypto.randomBytes(32).toString('hex');
const sitePublic = (process.env.SITE_PUBLIC_URL || process.env.SITE_API_URL).replace(/\/$/, '');
const siteAuth = process.env.CMS_AUTH_PROVIDER === 'site';
function redirect(res, target) { return res.redirect(cmsUrl(target)); }
function publicBody(html) { return html.replace(/(href|src)="\/(?!\/)/g, `$1="${sitePublic}/`); }
function secureCookie(req) { return (process.env.CMS_BASE_URL || '').startsWith('https:') || req.secure ? '; Secure' : ''; }
function requireLogin(req, res, next) { if (!req.user) return redirect(res, '/login'); next(); }
function requireManager(req, res, next) { if (!['owner', 'superuser'].includes(req.user?.role)) return res.status(403).send('Forbidden'); next(); }
function message(error) { return encodeURIComponent(error.message || String(error)); }
function canEdit(user, id) {
  if (user.role !== 'author') return true;
  return !!db.prepare('SELECT 1 FROM article_owners WHERE article_id=? AND user_id=?').get(id, user.id);
}
function articlePayload(req, image, status) {
  return { title: req.body.title, slug: req.body.slug, body: req.body.body, excerpt: req.body.excerpt,
    author: req.body.author, image, tags: String(req.body.tags || '').split(',').map(v => v.trim()).filter(Boolean),
    postType: req.body.postType, status, actor: req.user.email };
}
function editLink(url, title) {
  return `<a class="edit-link" href="${e(url)}" aria-label="${e(`Edit ${title}`)}" title="${e(`Edit ${title}`)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg><span>Edit</span></a>`;
}
function websiteArticleUrl(article) {
  const url = new URL(`/articles/${encodeURIComponent(article.slug)}`, sitePublic);
  if (article.status !== 'published') {
    const expires = String(Math.floor(Date.now() / 1000) + 900);
    const signature = crypto.createHmac('sha256', process.env.CMS_API_TOKEN)
      .update(`article-preview:${article.slug}:${expires}`).digest('hex');
    url.searchParams.set('preview', expires);
    url.searchParams.set('signature', signature);
  }
  return url.href;
}
function articleForm(article = {}, error = '', canPublish = true, viewUrl = '') {
  const isNew = !article.id;
  const tags = Array.isArray(article.tags) ? article.tags.join(', ') : '';
  const safeBody = sanitizeHtml(article.body || '', { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','figure','figcaption']), allowedAttributes: { a: ['href','title'], img: ['src','alt'] } });
  return `<h1>${isNew ? 'New article' : `Edit article #${Number(article.id)}`}</h1>${error ? `<p class="notice">${e(error)}</p>` : ''}
    <form data-editor-form method="post" action="${isNew ? '/articles' : `/articles/${Number(article.id)}`}" enctype="multipart/form-data" onsubmit="document.getElementById('body').value=document.getElementById('editor').innerHTML">
    <div class="row"><label>Title<input name="title" required maxlength="300" value="${e(article.title)}"></label><label>Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${e(article.slug)}"></label></div>
    <div class="row"><label>Type<select name="postType">${Object.entries(postTypes).map(([value, label]) => `<option value="${value}" ${(article.postType || 'news') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Author byline<input name="author" required value="${e(article.author)}"></label></div>
    <label>Summary<textarea name="excerpt" maxlength="1000" style="min-height:90px">${e(article.excerpt)}</textarea></label>
    <label>Tags, separated by commas<input name="tags" value="${e(tags)}"></label>
    <label>Featured image URL<input name="image" value="${e(article.image)}"></label><label>Or upload image<input type="file" name="imageFile" accept="image/*"></label>
    ${article.image ? `<p><img src="${e(article.image.startsWith('/') ? sitePublic + article.image : article.image)}" alt="" style="max-width:280px"></p>` : ''}
    <label id="story-label">Story</label><div class="toolbar" role="group" aria-label="Formatting"><button type="button" onclick="document.execCommand('bold')"><b>Bold</b></button><button type="button" onclick="document.execCommand('italic')"><i>Italic</i></button><button type="button" onclick="document.execCommand('formatBlock',false,'h2')">Heading</button><button type="button" onclick="document.execCommand('insertUnorderedList')">List</button><button type="button" onclick="let u=prompt('Link URL');if(u)document.execCommand('createLink',false,u)">Link</button></div>
    <div class="editor" id="editor" role="textbox" aria-multiline="true" aria-labelledby="story-label" contenteditable="true">${publicBody(safeBody)}</div><input type="hidden" name="body" id="body">
    <p class="save-status" role="status" data-save-status>Changes are saved when you select Save.</p><p class="row actions"><button name="intent" value="save">${article.status === 'published' ? 'Save changes' : 'Save draft'}</button>
    ${canPublish && article.status !== 'published' ? '<button name="intent" value="publish">Publish</button>' : ''}${viewUrl ? `<a class="button secondary" href="${e(viewUrl)}" target="_blank" rel="noopener noreferrer">View page on website</a>` : ''}</p>
    ${viewUrl && article.status !== 'published' ? '<p class="save-status">Shows the saved draft. Save changes before viewing. Preview links expire in 15 minutes.</p>' : ''}
    </form>${article.status === 'published' && canPublish ? `<form method="post" action="/articles/${Number(article.id)}/unpublish" onsubmit="return confirm('Unpublish this article? It will no longer be visible on the public site. Unsaved edits are not included.')"><button class="secondary danger">Unpublish article</button></form>` : ''}`;
}

const postTypes = { news: 'News', blog: 'Blog', album: 'Album', playlist: 'Playlist' };
const attempts = new Map();
app.get('/login', (req, res) => req.user ? redirect(res, '/') : res.send(layout('Login', null,
  `<h1>Staff login</h1>${siteAuth ? '<p>Use your LyricalSource site account. CMS access requires a staff invitation.</p>' : process.env.CMS_DEMO_MODE === '1' ? '<p>Local demo account</p>' : '<p>Use your CMS staff account. This login is separate from your public site account.</p>'}<form method="post" action="/login" class="card short"><label>Email or username<input type="text" name="email" required autocomplete="username"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button>Log in</button></form>`, req.query.error)));
app.post('/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const key = `${req.ip}:${email}`;
  const entry = attempts.get(key) || { count: 0, until: 0 };
  if (entry.count >= 6 && entry.until > Date.now()) return res.status(429).send('Try again later');
  const user = db.prepare('SELECT * FROM users WHERE (email=? COLLATE NOCASE OR username=? COLLATE NOCASE) AND active=1').get(email, email);
  let valid = false;
  if (user && password) {
    try {
      valid = siteAuth ? await authenticate(user.email, password) : verifyPassword(password, user.password_hash);
    } catch (error) {
      console.error('CMS site authentication unavailable:', error.message);
      return res.status(502).send(layout('Login', null, '<h1>Staff login unavailable</h1><p>Please try again shortly.</p>'));
    }
  }
  if (!valid) {
    attempts.set(key, { count: entry.until > Date.now() ? entry.count + 1 : 1, until: Date.now() + 15 * 60 * 1000 });
    return redirect(res, '/login?error=Invalid+login');
  }
  attempts.delete(key);
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token), user.id, Date.now() + 12 * 3600 * 1000);
  res.set('Set-Cookie', `cms_session=${token}; HttpOnly; SameSite=Strict; Path=${cmsUrl('/')}; Max-Age=43200${secureCookie(req)}`);
  redirect(res, '/');
});
app.post('/logout', requireLogin, (req, res) => {
  const token = /(?:^|;\s*)cms_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
  res.set('Set-Cookie', `cms_session=; HttpOnly; SameSite=Strict; Path=${cmsUrl('/')}; Max-Age=0${secureCookie(req)}`);
  redirect(res, '/login');
});
const usernameField = value => `<label>Username<input name="username" value="${e(value || '')}" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]{3,30}" autocomplete="username"><small>3–30 letters, numbers, or underscores.</small></label>`;
app.get('/account', requireLogin, (req, res) => res.send(layout('Account', req.user,
  `<h1>Account settings</h1><form class="card short" method="post" action="/account/profile"><h2>Profile</h2><label>Display name<input name="name" required maxlength="100" value="${e(req.user.name)}"></label>${usernameField(req.user.username)}<button>Save profile</button></form>` + (siteAuth
  ? '<p>Your password is managed by your LyricalSource site account.</p>'
  : '<h2>Change password</h2><form class="card short" method="post" action="/account"><label>Current password<input type="password" name="current" required></label><label>New password<input type="password" name="password" required></label><button>Change password</button></form>'), req.query.notice)));
app.post('/account/profile', requireLogin, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  if (!/^[a-z0-9_]{3,30}$/.test(username) || !name || name.length > 100) return res.status(400).send('Use a display name and a username with 3–30 letters, numbers, or underscores');
  if (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>?').get(username, req.user.id)) return redirect(res, '/account?notice=Username+already+taken');
  try { db.prepare('UPDATE users SET name=?,username=? WHERE id=?').run(name, username, req.user.id); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return redirect(res, '/account?notice=Username+already+taken'); throw error; }
  redirect(res, '/account?notice=Profile+saved');
});
app.post('/account', requireLogin, (req, res) => {
  if (siteAuth) return res.status(403).send('Password is managed by the LyricalSource site');
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(String(req.body.current || ''), row.password_hash)) return redirect(res, '/account?notice=Current+password+is+incorrect');
  if (!String(req.body.password || '').length) return redirect(res, '/account?notice=Enter+a+new+password');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(req.body.password), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
  redirect(res, '/login?error=Password+changed.+Log+in+again');
});

app.get('/', requireLogin, async (req, res) => {
  if (req.query.type === 'album') return redirect(res, '/albums');
  if (req.query.type === 'playlist') return redirect(res, '/playlists');
  try {
    const { articles } = await request('GET', 'articles');
    let visible = req.user.role === 'author' ? articles.filter(a => canEdit(req.user, a.id) && a.status === 'draft') : articles;
    const q = String(req.query.q || '').trim().slice(0, 200);
    const status = ['published', 'draft'].includes(req.query.status) ? req.query.status : 'all';
    const type = Object.hasOwn(postTypes, req.query.type || '') ? req.query.type : 'all';
    if (type !== 'all') visible = visible.filter(article => article.postType === type);
    const sort = ['oldest', 'title'].includes(req.query.sort) ? req.query.sort : 'newest';
    const counts = { all: visible.length, published: visible.filter(a => a.status === 'published').length, draft: visible.filter(a => a.status === 'draft').length };
    const filtered = visible.filter(a => (status === 'all' || a.status === status) && (type === 'all' || a.postType === type) &&
      (!q || [a.title, a.slug, a.author, ...(Array.isArray(a.tags) ? a.tags : [])].join(' ').toLowerCase().includes(q.toLowerCase())));
    filtered.sort((a, b) => {
      if (sort === 'title') return String(a.title).localeCompare(String(b.title));
      const first = Date.parse(a.updatedAt || a.publishedAt || '') || 0;
      const second = Date.parse(b.updatedAt || b.publishedAt || '') || 0;
      return (sort === 'oldest' ? first - second : second - first) || Number(b.id) - Number(a.id);
    });
    const tabs = [['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([value, label]) => {
      const query = new URLSearchParams({ status: value, q, type, sort });
      return `<a class="status-tab" href="/?${e(query.toString())}" ${status === value ? 'aria-current="page"' : ''}>${label}<span>${counts[value]}</span></a>`;
    }).join('');
    const rows = filtered.map(a => {
      const image = a.image && (a.image.startsWith('/') && !a.image.startsWith('//') ? sitePublic + a.image : /^https?:\/\//.test(a.image) ? a.image : '');
      const tags = (Array.isArray(a.tags) ? a.tags : []).slice(0, 3).map(tag => `<span class="story-tag">${e(tag)}</span>`).join('');
      const date = new Date(a.updatedAt || a.publishedAt || '');
      const validDate = !Number.isNaN(date.getTime());
      const dateText = validDate ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(date) : '—';
      return `<tr><td><div class="story-cell">${image ? `<img class="story-thumb" src="${e(image)}" alt="" loading="lazy">` : '<span class="story-thumb story-placeholder" aria-hidden="true">L</span>'}<div class="story-copy"><a class="story-title" href="/articles/${Number(a.id)}">${e(a.title)}</a><span class="story-slug">${e(a.slug)}</span>${tags ? `<div class="story-tags">${tags}</div>` : ''}</div></div></td><td><span class="badge ${a.status === 'published' ? 'published' : 'draft'}"><span class="badge-dot" aria-hidden="true"></span>${a.status === 'published' ? 'Published' : 'Draft'}</span></td><td class="story-type">${postTypes[a.postType] || 'News'}</td><td class="story-author">${e(a.author || '—')}</td><td class="story-date">${validDate ? `<time datetime="${e(date.toISOString())}">${dateText}</time>` : dateText}</td><td>${editLink(`/articles/${Number(a.id)}`, a.title)}</td></tr>`;
    }).join('');
    res.send(layout(type === 'album' ? 'Albums' : type === 'playlist' ? 'Playlists' : 'Articles', req.user, `<section class="stories-header"><div class="stories-intro"><p class="eyebrow">Editorial workspace</p><h1>${type === 'album' ? 'Your albums.' : type === 'playlist' ? 'Your playlists.' : 'Your stories.'}</h1><p>Write, publish, and manage the stories shaping music culture.</p></div><div class="story-metrics" aria-label="Article counts"><div class="story-metric"><span class="metric-symbol total" aria-hidden="true">▤</span><strong>${counts.all}</strong><span>Total ${type === 'album' ? 'albums' : type === 'playlist' ? 'playlists' : 'articles'}</span></div><div class="story-metric"><span class="metric-symbol published" aria-hidden="true"></span><strong>${counts.published}</strong><span>Published</span></div><div class="story-metric"><span class="metric-symbol draft" aria-hidden="true"></span><strong>${counts.draft}</strong><span>Drafts</span></div></div><a class="button new-story" href="/articles/new${type === 'album' || type === 'playlist' ? `?type=${type}` : ''}"><span aria-hidden="true">＋</span> New ${type === 'album' || type === 'playlist' ? type : 'article'}</a></section>
      <section class="story-tools" aria-label="Filter articles"><nav class="status-tabs" aria-label="Article status">${tabs}</nav><form class="story-filters" method="get" action="/"><input type="hidden" name="status" value="${e(status)}"><label class="story-search"><span class="sr-only">Search articles</span><input type="search" name="q" value="${e(q)}" placeholder="Search articles…" maxlength="200"></label><label><span class="sr-only">Article type</span><select name="type">${[['all','All types'], ...Object.entries(postTypes)].map(([value,label]) => `<option value="${value}" ${type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span class="sr-only">Sort articles</span><select name="sort">${[['newest','Newest first'],['oldest','Oldest first'],['title','Title A–Z']].map(([value,label]) => `<option value="${value}" ${sort === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="filter-submit">Apply</button></form></section>
      <div class="card table-card stories-table"><table><caption class="sr-only">Articles</caption><thead><tr><th>Article</th><th>Status</th><th>Type</th><th>Author</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows || `<tr><td colspan="6"><div class="story-empty"><h2>${(visible.length || q) ? 'No matching articles' : 'Your next story starts here'}</h2><p>${(visible.length || q) ? 'Try another search or change the filters.' : 'Create an article to start your first draft.'}</p><a href="${(visible.length || q) ? '/' : '/articles/new'}">${(visible.length || q) ? 'Clear filters' : 'New article'}</a></div></td></tr>`}</tbody></table></div><p class="results-summary" role="status">Showing ${filtered.length} of ${visible.length} articles</p>`, req.query.notice));
  } catch (error) { res.status(502).send(layout('Articles', req.user, '<h1>Site connection failed</h1>', error.message)); }
});
require('./playlists')(app, requireLogin, sitePublic);
require('./albums')(app, requireLogin, sitePublic);
app.get('/articles/new', requireLogin, (req, res) => res.send(layout('New article', req.user, articleForm({ author: req.user.name || req.user.email, postType: Object.hasOwn(postTypes, req.query.type || '') ? req.query.type : 'news' }, '', req.user.role !== 'author'))));
app.get('/articles/:id', requireLogin, async (req, res) => {
  try {
    const { article } = await request('GET', `articles/${Number(req.params.id)}`);
    if (!canEdit(req.user, article.id) || (req.user.role === 'author' && article.status === 'published')) return res.status(403).send('Forbidden');
    res.send(layout('Edit article', req.user, articleForm(article, req.query.error, req.user.role !== 'author', websiteArticleUrl(article)), req.query.notice));
  } catch (error) { res.status(502).send(layout('Error', req.user, '<h1>Cannot open article</h1>', error.message)); }
});
app.get('/articles/:id/preview', requireLogin, async (req, res) => {
  try {
    const { article } = await request('GET', `articles/${Number(req.params.id)}`);
    if (!canEdit(req.user, article.id)) return res.status(403).send('Forbidden');
    const body = sanitizeHtml(article.body, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','figure','figcaption']), allowedAttributes: { a: ['href','title'], img: ['src','alt'] } });
    res.send(layout('Preview', req.user, `<p><a href="/articles/${article.id}">← Edit</a></p><div class="preview"><small>${e(article.status.toUpperCase())}</small><h1>${e(article.title)}</h1><p>${e(article.excerpt)}</p>${article.image ? `<img src="${e(article.image.startsWith('/') ? sitePublic + article.image : article.image)}" alt="">` : ''}${publicBody(body)}</div>`));
  } catch (error) { res.status(502).send(layout('Error', req.user, '<h1>Cannot preview article</h1>', error.message)); }
});
async function saveArticle(req, res, id) {
  if (id && !canEdit(req.user, id)) return res.status(403).send('Forbidden');
  if (req.body.intent === 'publish' && req.user.role === 'author') return res.status(403).send('Authors cannot publish');
  let current;
  try {
    if (!['save', 'draft', 'publish'].includes(req.body.intent || 'save')) return res.status(400).send('Invalid save action');
    if (id) {
      current = (await request('GET', `articles/${id}`)).article;
      if (req.user.role === 'author' && current.status === 'published') return res.status(403).send('Authors cannot edit published articles');
    }
    const status = req.body.intent === 'publish' ? 'published' : (current?.status || 'draft');
    let image = String(req.body.image || '').trim();
    if (req.file) {
      const form = new FormData();
      form.append('image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
      image = (await request('POST', 'media', form, true)).url;
    }
    const payload = articlePayload(req, image, status);
    const saved = await request(id ? 'PUT' : 'POST', id ? `articles/${id}` : 'articles', payload);
    if (!id) db.prepare('INSERT INTO article_owners (article_id,user_id) VALUES (?,?)').run(saved.id, req.user.id);
    redirect(res, `/articles/${saved.id}?notice=Saved`);
  } catch (error) {
    res.status(400).send(layout('Article error', req.user, articleForm({ ...req.body, id, status: current?.status, tags: String(req.body.tags || '').split(',') }, error.message, req.user.role !== 'author')));
  }
}
app.post('/articles', requireLogin, upload.single('imageFile'), (req, res) => saveArticle(req, res, null));
app.post('/articles/:id', requireLogin, upload.single('imageFile'), (req, res) => saveArticle(req, res, Number(req.params.id)));
app.post('/articles/:id/unpublish', requireLogin, async (req, res) => {
  if (req.user.role === 'author') return res.status(403).send('Authors cannot unpublish');
  try {
    const id = Number(req.params.id);
    const { article } = await request('GET', `articles/${id}`);
    const { title, slug, body, excerpt, author, image, tags, postType } = article;
    await request('PUT', `articles/${id}`, { title, slug, body, excerpt, author, image, tags, postType, status: 'draft', actor: req.user.email });
    redirect(res, `/articles/${id}?notice=Article+unpublished`);
  } catch (error) {
    res.status(502).send(layout('Unpublish failed', req.user, '<h1>Could not unpublish</h1><p>Your request could not be confirmed. Reopen the article to check its current status before trying again.</p><a href="/">Back to articles</a>', error.message));
  }
});


function requirePublisher(req, res, next) {
  if (!['superuser', 'owner', 'editor'].includes(req.user?.role)) return res.status(403).send('Forbidden');
  next();
}
function songForm(song, error = '') {
  return `<h1>Edit song</h1>${error ? `<p class="notice">${e(error)}</p>` : ''}<p>${e(song.artistName)} · ${e(song.slug)}</p>
    <form data-editor-form method="post" class="card" action="/songs/${Number(song.id)}">
    <label>Display title<input name="title" required maxlength="300" value="${e(song.title)}"></label>
    <label>Song name<input name="songName" required maxlength="300" value="${e(song.songName)}"></label>
    <p>The song URL stays the same. Saving updates the public song immediately.</p><button>Save song</button></form>`;
}
app.get('/songs', requireLogin, requirePublisher, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 200);
    const { songs } = await request('GET', `songs?q=${encodeURIComponent(q)}`);
    const rows = songs.map(song => `<tr><td><a href="/songs/${Number(song.id)}">${e(song.title)}</a></td><td>${e(song.songName)}</td><td>${e(song.artistName)}</td><td>${editLink(`/songs/${Number(song.id)}`, song.title)}</td></tr>`).join('');
    res.send(layout('Songs', req.user, `<h1>Songs</h1><form method="get"><label>Search title or song name<input name="q" value="${e(q)}" maxlength="200"></label><button>Search</button></form><table><tr><th>Title</th><th>Song name</th><th>Artist</th><th>Actions</th></tr>${rows || '<tr><td colspan="4">No songs found.</td></tr>'}</table>`));
  } catch { res.status(502).send(layout('Songs', req.user, '<h1>Song connection unavailable</h1><p>The connected site needs the CMS song API. No changes were saved.</p>')); }
});
app.get('/songs/:id', requireLogin, requirePublisher, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).send('Invalid song id');
    const { song } = await request('GET', `songs/${id}`);
    res.send(layout('Edit song', req.user, songForm(song), req.query.notice));
  } catch { res.status(502).send(layout('Edit song', req.user, '<h1>Cannot open song</h1>')); }
});
app.post('/songs/:id', requireLogin, requirePublisher, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).send('Invalid song id');
  const title = String(req.body.title || '').trim();
  const songName = String(req.body.songName || '').trim();
  const song = { id, title, songName };
  if (!title || !songName || title.length > 300 || songName.length > 300) return res.status(400).send(layout('Edit song', req.user, songForm(song, 'Title and song name must contain 1–300 characters')));
  try {
    await request('PUT', `songs/${id}`, { title, songName, actor: req.user.email });
    redirect(res, `/songs/${id}?notice=Saved`);
  } catch { res.status(502).send(layout('Edit song', req.user, songForm(song, 'Save could not be confirmed. Reopen the song to check its current name before retrying.'))); }
});

function rolesFor(user) { return user.role === 'superuser' ? ['owner','editor','author'] : ['editor','author']; }
app.get('/team', requireLogin, requireManager, (req, res) => {
  const users = db.prepare('SELECT id,email,name,username,role,active FROM users ORDER BY id').all();
  const invites = db.prepare('SELECT id,email,role,expires_at,accepted_at,revoked_at FROM invites ORDER BY id DESC LIMIT 30').all();
  const options = rolesFor(req.user).map(role => `<option value="${role}">${role}</option>`).join('');
  const userRows = users.map(user => `<tr><td>${e(user.name)}</td><td>${e(user.username)}</td><td>${e(user.email)}</td><td>${e(user.role)}</td><td>${user.active ? 'Active' : 'Disabled'}</td><td>${user.id === req.user.id || user.role === 'superuser' || (user.role === 'owner' && req.user.role !== 'superuser') ? '' : `<form method="post" action="/team/users/${user.id}"><select name="role"><option value="${e(user.role)}">${e(user.role)}</option>${options}</select><select name="active"><option value="1" ${user.active ? 'selected' : ''}>Active</option><option value="0" ${!user.active ? 'selected' : ''}>Disabled</option></select><button>Update</button></form>`}</td></tr>`).join('');
  const inviteRows = invites.map(i => `<tr><td>${e(i.email)}</td><td>${e(i.role)}</td><td>${i.accepted_at ? 'Accepted' : i.revoked_at ? 'Revoked' : i.expires_at < Date.now() ? 'Expired' : 'Pending'}</td><td>${!i.accepted_at && !i.revoked_at ? `<form method="post" action="/team/invites/${i.id}/revoke"><button class="secondary">Revoke</button></form>` : ''}</td></tr>`).join('');
  res.send(layout('Team', req.user, `<h1>Team</h1><div class="card"><h2>Invite a person</h2><form method="post" action="/team/invites"><div class="row"><label>Email<input type="email" name="email" required></label><label>Role<select name="role">${options}</select></label></div><button>Send invitation</button></form></div>
  <h2>Users</h2><div class="card"><table><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Control</th></tr>${userRows}</table></div><h2>Invitations</h2><div class="card"><table><tr><th>Email</th><th>Role</th><th>Status</th><th>Control</th></tr>${inviteRows}</table></div>`, req.query.notice));
});
app.post('/team/invites', requireLogin, requireManager, async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const role = String(req.body.role || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !rolesFor(req.user).includes(role)) return res.status(400).send('Invalid invitation');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return redirect(res, '/team?notice=User+already+exists');
  const token = randomToken();
  db.prepare('INSERT INTO invites (email,role,token_hash,invited_by,expires_at) VALUES (?,?,?,?,?)').run(email, role, digest(token), req.user.id, Date.now() + 72 * 3600 * 1000);
  const link = `${process.env.CMS_BASE_URL || 'http://127.0.0.1:3100'}/invite/${token}`;
  if (process.env.SMTP_HOST) {
    try {
      const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
      await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Your LyricalSource CMS invitation', text: `Open this link within 72 hours to create your account:\n${link}` });
      return redirect(res, '/team?notice=Invitation+email+sent');
    } catch (error) { /* Show copyable link if mail is unavailable. */ }
  }
  res.send(layout('Invitation created', req.user, `<h1>Invitation created</h1><p>Email delivery is not configured or failed. Copy this one-time link now:</p><input readonly value="${e(link)}"><p><a href="/team">Back to team</a></p>`));
});
app.post('/team/invites/:id/revoke', requireLogin, requireManager, (req, res) => {
  db.prepare('UPDATE invites SET revoked_at=? WHERE id=? AND accepted_at IS NULL').run(Date.now(), Number(req.params.id));
  redirect(res, '/team?notice=Invitation+revoked');
});
app.post('/team/users/:id', requireLogin, requireManager, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT role FROM users WHERE id=?').get(id);
  if (!target || id === req.user.id || target.role === 'superuser' || (target.role === 'owner' && req.user.role !== 'superuser')) return res.status(403).send('Forbidden');
  const role = String(req.body.role || '');
  if (!rolesFor(req.user).includes(role)) return res.status(400).send('Invalid role');
  db.prepare('UPDATE users SET role=?, active=? WHERE id=?').run(role, req.body.active === '1' ? 1 : 0, id);
  if (req.body.active !== '1') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  redirect(res, '/team?notice=User+updated');
});
app.get('/invite/:token', (req, res) => {
  const invite = db.prepare('SELECT email,role FROM invites WHERE token_hash=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL').get(digest(req.params.token), Date.now());
  if (!invite) return res.status(410).send('Invitation expired or unavailable');
  res.send(layout('Accept invitation', null, `<h1>Join LyricalSource CMS</h1><p>${e(invite.email)} · ${e(invite.role)}</p>${siteAuth ? '<p>Sign in with this email and your LyricalSource site password after accepting.</p>' : ''}<form method="post" class="card short"><label>Name<input name="name" required></label>${usernameField('')}${siteAuth ? '' : '<label>Password<input type="password" name="password" required></label>'}<button>Create account</button></form>`, req.query.error));
});
app.post('/invite/:token', (req, res) => {
  const invite = db.prepare('SELECT * FROM invites WHERE token_hash=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL').get(digest(req.params.token), Date.now());
  if (!invite) return res.status(410).send('Invitation expired or unavailable');
  const name = String(req.body.name || '').trim().slice(0, 100);
  const username = String(req.body.username || '').trim().toLowerCase();
  if (username && (!/^[a-z0-9_]{3,30}$/.test(username) || db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(username))) return redirect(res, `/invite/${req.params.token}?error=Username+invalid+or+already+taken`);
  const password = siteAuth ? randomToken() : String(req.body.password || '');
  if (!name || !password.length) return redirect(res, `/invite/${req.params.token}?error=Name+and+password+required`);
  try {
    db.transaction(() => {
      const created = db.prepare('INSERT INTO users (email,name,password_hash,role,username) VALUES (?,?,?,?,?)').run(invite.email, name, hashPassword(password), invite.role, username || null);
      if (!username) {
        let automatic = `staff${created.lastInsertRowid}`;
        while (db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(automatic)) automatic += '_';
        db.prepare('UPDATE users SET username=? WHERE id=?').run(automatic, created.lastInsertRowid);
      }
      db.prepare('UPDATE invites SET accepted_at=? WHERE id=?').run(Date.now(), invite.id);
    })();
    redirect(res, '/login?error=Account+created.+Log+in');
  } catch { res.status(409).send('Account already exists'); }
});
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).send('Image must be under 5 MB');
  next(error);
});
module.exports = app;
