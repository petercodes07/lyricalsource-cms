const crypto = require('node:crypto');
const { escape: e, layout, cmsUrl } = require('./views');
module.exports = (app, { db, digest, hashPassword, sendMail }) => {
  db.exec('CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)');
  const limits = new Map();
  const generic = 'If this email belongs to an active staff account, a reset link will be sent. Check your inbox or contact your team owner.';
  app.get('/forgot-password', (req, res) => {
    if (process.env.CMS_AUTH_PROVIDER === 'site') {
      const configured = process.env.SITE_PASSWORD_RESET_URL || '';
      let link = '';
      try { const url = new URL(configured); if (url.protocol === 'https:' && !url.username && !url.password) link = `<a class="button" href="${e(url.href)}" target="_blank" rel="noopener noreferrer">Reset your site password</a>`; } catch {}
      return res.send(layout('Password help', null, `<h1>Reset your password</h1><p>Your password is managed by your LyricalSource site account.</p>${link || '<p>Use the password recovery option on the public site, or contact your team owner.</p>'}<a href="/login">Back to login</a>`));
    }
    res.send(layout('Password help', null, '<h1>Reset your password</h1><form class="card short" method="post"><label>Staff email<input name="email" type="email" required autocomplete="email"></label><button>Send reset link</button></form><a href="/login">Back to login</a>', req.query.notice));
  });
  app.post('/forgot-password', async (req, res) => {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const entry = limits.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count++; limits.set(req.ip, entry);
    if (entry.count <= 5 && process.env.CMS_AUTH_PROVIDER !== 'site' && process.env.SMTP_HOST) {
      const user = db.prepare('SELECT id,email FROM users WHERE email=? COLLATE NOCASE AND active=1').get(String(req.body.email || '').trim());
      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<?').run(user.id, now);
        db.prepare('INSERT INTO password_resets VALUES (?,?,?)').run(digest(token), user.id, now + 30 * 60 * 1000);
        const link = new URL(cmsUrl('/reset-password/' + token), process.env.CMS_BASE_URL || 'http://127.0.0.1:3100').href;
        try { await sendMail(user.email, 'Reset your LyricalSource CMS password', `Use this one-time link within 30 minutes:\n${link}\nIf you did not request this, ignore this email.`); }
        catch { db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(digest(token)); }
      }
    }
    res.redirect(cmsUrl('/forgot-password?notice=' + encodeURIComponent(generic)));
  });
  const valid = token => process.env.CMS_AUTH_PROVIDER !== 'site' && db.prepare('SELECT r.user_id FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>? AND u.active=1').get(digest(token), Date.now());
  app.get('/reset-password/:token', (req, res) => {
    if (!valid(req.params.token)) return res.status(410).send(layout('Password help', null, '<h1>This reset link expired or was already used</h1><a href="/forgot-password">Request a new link</a>'));
    res.send(layout('Reset password', null, '<h1>Choose a new password</h1><form class="card short" method="post"><label>New password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><button>Reset password</button></form>'));
  });
  app.post('/reset-password/:token', (req, res) => {
    const password = String(req.body.password || '');
    if (password.length < 12 || password.length > 1024) return res.status(400).send(layout('Reset password', null, '<h1>Use a password of 12–1024 characters</h1><p>Go back and enter a longer password.</p>'));
    const reset = valid(req.params.token);
    if (!reset) return res.status(410).send('Reset link expired or already used');
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), reset.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(reset.user_id);
      db.prepare('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id);
    })();
    res.redirect(cmsUrl('/login?error=Password+reset.+Log+in+with+your+new+password.'));
  });
};
