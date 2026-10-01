function workspaceUrl(value, demo = false) {
  const url = new URL(String(value).trim());
  if (url.username || url.password || url.search || url.hash || !['/', '/cms', '/cms/'].includes(url.pathname)) throw new Error('Use the workspace URL at / or /cms without credentials or a query.');
  if (url.protocol !== 'https:' && !(demo && url.origin === 'http://127.0.0.1:3100')) throw new Error('The shared workspace must use HTTPS.');
  return url.origin + (url.pathname.startsWith('/cms') ? '/cms' : '');
}
function sameWorkspace(value, origin) {
  try { const url = new URL(value); const base = new URL(origin); const scope = base.pathname.replace(/\/$/, ''); return url.origin === base.origin && !url.username && !url.password && (!scope || url.pathname === scope || url.pathname.startsWith(scope + '/')); } catch { return false; }
}
function externalUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
module.exports = { workspaceUrl, sameWorkspace, externalUrl };
