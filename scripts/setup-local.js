const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const password = process.env.CMS_SUPERUSER_PASSWORD;
if (!password) {
  console.error('Set CMS_SUPERUSER_PASSWORD in your shell before running setup:local.');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const site = path.resolve(root, '../lyricalsource');
if (!fs.existsSync(path.join(site, 'db/010_cms_publishing.sql'))) {
  console.error('Clone the lyricalsource site repository beside this one and switch to cms-integration.');
  process.exit(1);
}
const cmsFile = path.join(root, '.env.local');
const siteFile = path.join(site, '.env.local');
if (fs.existsSync(cmsFile) || fs.existsSync(siteFile)) {
  console.error('An .env.local file already exists. Move it aside or configure both files manually.');
  process.exit(1);
}
const token = crypto.randomBytes(48).toString('hex');
const cms = `PORT=3100\nHOST=127.0.0.1\nCMS_DB_PATH=./data/cms.sqlite\nSITE_API_URL=http://127.0.0.1:3000\nSITE_PUBLIC_URL=http://127.0.0.1:3000\nCMS_API_TOKEN=${token}\nCMS_SUPERUSER_EMAIL=pitahquriah@gmail.com\nCMS_SUPERUSER_PASSWORD=${password}\nCMS_BASE_URL=http://127.0.0.1:3100\n`;
const web = `DB_HOST=127.0.0.1\nDB_PORT=3307\nDB_USER=lyricsuser\nDB_PASSWORD=local-dev-only\nDB_NAME=lyricalsource_cms_dev\nCMS_API_TOKEN=${token}\n`;
fs.writeFileSync(cmsFile, cms, { mode: 0o600, flag: 'wx' });
fs.writeFileSync(siteFile, web, { mode: 0o600, flag: 'wx' });
console.log('Local environment files created. Start MySQL, the site, and the CMS as described in README.md.');
