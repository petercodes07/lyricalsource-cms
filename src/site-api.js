const { createLimit } = require('./resource-limit');
const limit = createLimit(6, 64);
const base = process.env.SITE_API_URL?.replace(/\/$/, '');
const token = process.env.CMS_API_TOKEN;
if (!base || !token) throw new Error('SITE_API_URL and CMS_API_TOKEN are required');

async function request(method, route, body, multipart = false) {
  return limit(async () => {
  const response = await fetch(`${base}/api/cms/${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(!multipart && body ? { 'content-type': 'application/json' } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Site API returned ${response.status}`), { status: response.status });
  return data;
  });
}

async function authenticate(email, password) {
  return limit(async () => {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error(`Site login returned ${response.status}`);
  const data = await response.json().catch(() => null);
  if (data?.ok !== true) throw new Error('Site login returned an unexpected response');
  return true;
  });
}
module.exports = { request, authenticate };
