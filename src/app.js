require('dotenv').config({ path: process.env.CMS_ENV_FILE || '.env.local', quiet: true });
const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const sanitizeHtml = require('sanitize-html');
const { db, digest, hashPassword, verifyPassword } = require('./store');
const { request } = require('./site-api');
const { escape: e, layout } = require('./views');

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: http: https:; form-action 'self'; base-uri 'self'");
  if (req.method === 'POST') {
    const origin = req.get('origin');
    const expected = process.env.CMS_BASE_URL || `http://${req.get('host')}`;
    if (origin && origin !== expected) return res.status(403).send('Invalid request origin');
  }
  const raw = /(?:^|;\s*)cms_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (raw) {
    req.user = db.prepare(`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digest(raw), Date.now());
  }
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const randomToken = () => crypto.randomBytes(32).toString('hex');
const sitePublic = (process.env.SITE_PUBLIC_URL || process.env.SITE_API_URL).replace(/\/$/, '');
function secureCookie(req) { return (process.env.CMS_BASE_URL || '').startsWith('https:') || req.secure ? '; Secure' : ''; }
function requireLogin(req, res, next) { if (!req.user) return res.redirect('/login'); next(); }
function requireManager(req, res, next) { if (!['owner', 'superuser'].includes(req.user?.role)) return res.status(403).send('Forbidden'); next(); }
function message(error) { return encodeURIComponent(error.message || String(error)); }
function canEdit(user, id) {
  if (user.role !== 'author') return true;
  return !!db.prepare('SELECT 1 FROM article_owners WHERE article_id=? AND user_id=?').get(id, user.id);
}
function articlePayload(req, image) {
  return { title: req.body.title, slug: req.body.slug, body: req.body.body, excerpt: req.body.excerpt,
    author: req.body.author, image, tags: String(req.body.tags || '').split(',').map(v => v.trim()).filter(Boolean),
    postType: req.body.postType, status: req.body.intent === 'publish' ? 'published' : 'draft', actor: req.user.email };
}
function articleForm(article = {}, error = '', canPublish = true) {
  const isNew = !article.id;
  const tags = Array.isArray(article.tags) ? article.tags.join(', ') : '';
  const safeBody = sanitizeHtml(article.body || '', { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','figure','figcaption']), allowedAttributes: { a: ['href','title'], img: ['src','alt'] } });
  return `<h1>${isNew ? 'New article' : `Edit article #${Number(article.id)}`}</h1>${error ? `<p class="notice">${e(error)}</p>` : ''}
    <form method="post" action="${isNew ? '/articles' : `/articles/${Number(article.id)}`}" enctype="multipart/form-data" onsubmit="document.getElementById('body').value=document.getElementById('editor').innerHTML">
    <div class="row"><label>Title<input name="title" required maxlength="300" value="${e(article.title)}"></label><label>Slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${e(article.slug)}"></label></div>
    <div class="row"><label>Type<select name="postType"><option value="news" ${article.postType !== 'blog' ? 'selected' : ''}>News</option><option value="blog" ${article.postType === 'blog' ? 'selected' : ''}>Blog</option></select></label><label>Author byline<input name="author" required value="${e(article.author)}"></label></div>
    <label>Summary<textarea name="excerpt" maxlength="1000" style="min-height:90px">${e(article.excerpt)}</textarea></label>
    <label>Tags, separated by commas<input name="tags" value="${e(tags)}"></label>
    <label>Featured image URL<input name="image" value="${e(article.image)}"></label><label>Or upload image<input type="file" name="imageFile" accept="image/*"></label>
    ${article.image ? `<p><img src="${e(article.image.startsWith('/') ? sitePublic + article.image : article.image)}" alt="" style="max-width:280px"></p>` : ''}
    <label>Story</label><div class="toolbar"><button type="button" onclick="document.execCommand('bold')"><b>Bold</b></button><button type="button" onclick="document.execCommand('italic')"><i>Italic</i></button><button type="button" onclick="document.execCommand('formatBlock',false,'h2')">Heading</button><button type="button" onclick="document.execCommand('insertUnorderedList')">List</button><button type="button" onclick="let u=prompt('Link URL');if(u)document.execCommand('createLink',false,u)">Link</button></div>
    <div class="editor" id="editor" contenteditable="true">${safeBody}</div><input type="hidden" name="body" id="body">
    <p class="row"><button name="intent" value="draft">Save draft</button>
    ${canPublish ? '<button name="intent" value="publish">Publish</button>' : ''}</p>
    </form>${!isNew ? `<p><a href="/articles/${Number(article.id)}/preview">Preview saved version</a></p>` : ''}`;
}

const attempts = new Map();
app.get('/login', (req, res) => req.user ? res.redirect('/') : res.send(layout('Login', null,
  `<h1>Staff login</h1><form method="post" action="/login" class="card short"><label>Email<input type="email" name="email" required autocomplete="username"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button>Log in</button></form>`, req.query.error)));
app.post('/login', (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const key = `${req.ip}:${email}`;
  const entry = attempts.get(key) || { count: 0, until: 0 };
  if (entry.count >= 6 && entry.until > Date.now()) return res.status(429).send('Try again later');
  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    attempts.set(key, { count: entry.count + 1, until: Date.now() + 15 * 60 * 1000 });
    return res.redirect('/login?error=Invalid+login');
  }
  attempts.delete(key);
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token), user.id, Date.now() + 12 * 3600 * 1000);
  res.set('Set-Cookie', `cms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie(req)}`);
  res.redirect('/');
});
app.post('/logout', requireLogin, (req, res) => {
  const token = /(?:^|;\s*)cms_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
  res.set('Set-Cookie', `cms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie(req)}`);
  res.redirect('/login');
});
app.get('/account', requireLogin, (req, res) => res.send(layout('Account', req.user, `<h1>Change password</h1><form class="card short" method="post"><label>Current password<input type="password" name="current" required></label><label>New password (12+ characters)<input type="password" name="password" minlength="12" required></label><button>Change password</button></form>`, req.query.notice)));
app.post('/account', requireLogin, (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(String(req.body.current || ''), row.password_hash)) return res.redirect('/account?notice=Current+password+is+incorrect');
  if (String(req.body.password || '').length < 12) return res.redirect('/account?notice=Use+at+least+12+characters');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(req.body.password), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
  res.redirect('/login?error=Password+changed.+Log+in+again');
});

app.get('/', requireLogin, async (req, res) => {
  try {
    const { articles } = await request('GET', 'articles');
    const visible = req.user.role === 'author' ? articles.filter(a => canEdit(req.user, a.id) && a.status === 'draft') : articles;
    const rows = visible.map(a => `<tr><td><a href="/articles/${a.id}">${e(a.title)}</a><br><small>${e(a.slug)}</small></td><td>${e(a.status)}</td><td>${e(a.postType)}</td><td>${e(a.updatedAt ? String(a.updatedAt).slice(0,10) : '')}</td></tr>`).join('');
    res.send(layout('Articles', req.user, `<div class="row"><h1>Articles</h1><a class="button" href="/articles/new">New article</a></div><div class="card"><table><tr><th>Title</th><th>Status</th><th>Type</th><th>Updated</th></tr>${rows}</table></div>`, req.query.notice));
  } catch (error) { res.status(502).send(layout('Articles', req.user, '<h1>Site connection failed</h1>', error.message)); }
});
app.get('/articles/new', requireLogin, (req, res) => res.send(layout('New article', req.user, articleForm({ author: req.user.name || req.user.email }, '', req.user.role !== 'author'))));
app.get('/articles/:id', requireLogin, async (req, res) => {
  try {
    const { article } = await request('GET', `articles/${Number(req.params.id)}`);
    if (!canEdit(req.user, article.id) || (req.user.role === 'author' && article.status === 'published')) return res.status(403).send('Forbidden');
    res.send(layout('Edit article', req.user, articleForm(article, req.query.error, req.user.role !== 'author') + (article.status === 'published' ? `<p><a href="${sitePublic}/articles/${e(article.slug)}" target="_blank" rel="noopener">View live article</a></p>` : ''), req.query.notice));
  } catch (error) { res.status(502).send(layout('Error', req.user, '<h1>Cannot open article</h1>', error.message)); }
});
app.get('/articles/:id/preview', requireLogin, async (req, res) => {
  try {
    const { article } = await request('GET', `articles/${Number(req.params.id)}`);
    if (!canEdit(req.user, article.id)) return res.status(403).send('Forbidden');
    const body = sanitizeHtml(article.body, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','figure','figcaption']), allowedAttributes: { a: ['href','title'], img: ['src','alt'] } });
    res.send(layout('Preview', req.user, `<p><a href="/articles/${article.id}">← Edit</a></p><div class="preview"><small>${e(article.status.toUpperCase())}</small><h1>${e(article.title)}</h1><p>${e(article.excerpt)}</p>${article.image ? `<img src="${e(article.image.startsWith('/') ? sitePublic + article.image : article.image)}" alt="">` : ''}${body}</div>`));
  } catch (error) { res.status(502).send(layout('Error', req.user, '<h1>Cannot preview article</h1>', error.message)); }
});
async function saveArticle(req, res, id) {
  if (id && !canEdit(req.user, id)) return res.status(403).send('Forbidden');
  if (req.body.intent === 'publish' && req.user.role === 'author') return res.status(403).send('Authors cannot publish');
  try {
    if (id && req.user.role === 'author') {
      const { article } = await request('GET', `articles/${id}`);
      if (article.status === 'published') return res.status(403).send('Authors cannot edit published articles');
    }
    let image = String(req.body.image || '').trim();
    if (req.file) {
      const form = new FormData();
      form.append('image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
      image = (await request('POST', 'media', form, true)).url;
    }
    const payload = articlePayload(req, image);
    const saved = await request(id ? 'PUT' : 'POST', id ? `articles/${id}` : 'articles', payload);
    if (!id) db.prepare('INSERT INTO article_owners (article_id,user_id) VALUES (?,?)').run(saved.id, req.user.id);
    res.redirect(`/articles/${saved.id}?notice=Saved`);
  } catch (error) {
    res.status(400).send(layout('Article error', req.user, articleForm({ ...req.body, id, tags: String(req.body.tags || '').split(',') }, error.message, req.user.role !== 'author')));
  }
}
app.post('/articles', requireLogin, upload.single('imageFile'), (req, res) => saveArticle(req, res, null));
app.post('/articles/:id', requireLogin, upload.single('imageFile'), (req, res) => saveArticle(req, res, Number(req.params.id)));

function rolesFor(user) { return user.role === 'superuser' ? ['owner','editor','author'] : ['editor','author']; }
app.get('/team', requireLogin, requireManager, (req, res) => {
  const users = db.prepare('SELECT id,email,name,role,active FROM users ORDER BY id').all();
  const invites = db.prepare('SELECT id,email,role,expires_at,accepted_at,revoked_at FROM invites ORDER BY id DESC LIMIT 30').all();
  const options = rolesFor(req.user).map(role => `<option value="${role}">${role}</option>`).join('');
  const userRows = users.map(user => `<tr><td>${e(user.email)}</td><td>${e(user.role)}</td><td>${user.active ? 'Active' : 'Disabled'}</td><td>${user.id === req.user.id || user.role === 'superuser' || (user.role === 'owner' && req.user.role !== 'superuser') ? '' : `<form method="post" action="/team/users/${user.id}"><select name="role"><option value="${e(user.role)}">${e(user.role)}</option>${options}</select><select name="active"><option value="1" ${user.active ? 'selected' : ''}>Active</option><option value="0" ${!user.active ? 'selected' : ''}>Disabled</option></select><button>Update</button></form>`}</td></tr>`).join('');
  const inviteRows = invites.map(i => `<tr><td>${e(i.email)}</td><td>${e(i.role)}</td><td>${i.accepted_at ? 'Accepted' : i.revoked_at ? 'Revoked' : i.expires_at < Date.now() ? 'Expired' : 'Pending'}</td><td>${!i.accepted_at && !i.revoked_at ? `<form method="post" action="/team/invites/${i.id}/revoke"><button class="secondary">Revoke</button></form>` : ''}</td></tr>`).join('');
  res.send(layout('Team', req.user, `<h1>Team</h1><div class="card"><h2>Invite a person</h2><form method="post" action="/team/invites"><div class="row"><label>Email<input type="email" name="email" required></label><label>Role<select name="role">${options}</select></label></div><button>Send invitation</button></form></div>
  <h2>Users</h2><div class="card"><table><tr><th>Email</th><th>Role</th><th>Status</th><th>Control</th></tr>${userRows}</table></div><h2>Invitations</h2><div class="card"><table><tr><th>Email</th><th>Role</th><th>Status</th><th>Control</th></tr>${inviteRows}</table></div>`, req.query.notice));
});
app.post('/team/invites', requireLogin, requireManager, async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const role = String(req.body.role || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !rolesFor(req.user).includes(role)) return res.status(400).send('Invalid invitation');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.redirect('/team?notice=User+already+exists');
  const token = randomToken();
  db.prepare('INSERT INTO invites (email,role,token_hash,invited_by,expires_at) VALUES (?,?,?,?,?)').run(email, role, digest(token), req.user.id, Date.now() + 72 * 3600 * 1000);
  const link = `${process.env.CMS_BASE_URL || 'http://127.0.0.1:3100'}/invite/${token}`;
  if (process.env.SMTP_HOST) {
    try {
      const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
      await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Your LyricalSource CMS invitation', text: `Open this link within 72 hours to create your account:\n${link}` });
      return res.redirect('/team?notice=Invitation+email+sent');
    } catch (error) { /* Show copyable link if mail is unavailable. */ }
  }
  res.send(layout('Invitation created', req.user, `<h1>Invitation created</h1><p>Email delivery is not configured or failed. Copy this one-time link now:</p><input readonly value="${e(link)}"><p><a href="/team">Back to team</a></p>`));
});
app.post('/team/invites/:id/revoke', requireLogin, requireManager, (req, res) => {
  db.prepare('UPDATE invites SET revoked_at=? WHERE id=? AND accepted_at IS NULL').run(Date.now(), Number(req.params.id));
  res.redirect('/team?notice=Invitation+revoked');
});
app.post('/team/users/:id', requireLogin, requireManager, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT role FROM users WHERE id=?').get(id);
  if (!target || id === req.user.id || target.role === 'superuser' || (target.role === 'owner' && req.user.role !== 'superuser')) return res.status(403).send('Forbidden');
  const role = String(req.body.role || '');
  if (!rolesFor(req.user).includes(role)) return res.status(400).send('Invalid role');
  db.prepare('UPDATE users SET role=?, active=? WHERE id=?').run(role, req.body.active === '1' ? 1 : 0, id);
  if (req.body.active !== '1') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.redirect('/team?notice=User+updated');
});
app.get('/invite/:token', (req, res) => {
  const invite = db.prepare('SELECT email,role FROM invites WHERE token_hash=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL').get(digest(req.params.token), Date.now());
  if (!invite) return res.status(410).send('Invitation expired or unavailable');
  res.send(layout('Accept invitation', null, `<h1>Join LyricalSource CMS</h1><p>${e(invite.email)} · ${e(invite.role)}</p><form method="post" class="card short"><label>Name<input name="name" required></label><label>Password (12+ characters)<input type="password" name="password" minlength="12" required></label><button>Create account</button></form>`, req.query.error));
});
app.post('/invite/:token', (req, res) => {
  const invite = db.prepare('SELECT * FROM invites WHERE token_hash=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL').get(digest(req.params.token), Date.now());
  if (!invite) return res.status(410).send('Invitation expired or unavailable');
  const name = String(req.body.name || '').trim().slice(0, 100);
  const password = String(req.body.password || '');
  if (!name || password.length < 12) return res.redirect(`/invite/${req.params.token}?error=Name+and+12-character+password+required`);
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)').run(invite.email, name, hashPassword(password), invite.role);
      db.prepare('UPDATE invites SET accepted_at=? WHERE id=?').run(Date.now(), invite.id);
    })();
    res.redirect('/login?error=Account+created.+Log+in');
  } catch { res.status(409).send('Account already exists'); }
});
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).send('Image must be under 5 MB');
  next(error);
});
module.exports = app;
