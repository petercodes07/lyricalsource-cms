const base = process.env.SITE_API_URL?.replace(/\/$/, '');
const token = process.env.CMS_API_TOKEN;
if (!base || !token) throw new Error('SITE_API_URL and CMS_API_TOKEN are required');

async function request(method, route, body, multipart = false) {
  const response = await fetch(`${base}/api/cms/${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(!multipart && body ? { 'content-type': 'application/json' } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Site API returned ${response.status}`);
  return data;
}
module.exports = { request };
