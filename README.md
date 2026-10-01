# LyricalSource CMS

Download the latest Windows, macOS or Linux installer from the [desktop releases page](https://github.com/petercodes07/lyricalsource-cms/releases/latest). The desktop **Help** menu shows its version and links to updates. Install a new release manually; automatic updating is not enabled.

Album and playlist editors support cover previews, image uploads through the site's media API, and formatted descriptions. Confirm that the companion site renders description HTML correctly before rollout. Failed saves retain the current form and selected files. Playlist songs can be added, removed and reordered; album track editing remains limited to the linked song editor until the site's album membership/ordering API is verified.

Local staff password recovery requires working SMTP configuration. Reset links expire after 30 minutes, work once, and revoke existing sessions. Site-authenticated staff use the public site's password recovery; set `SITE_PASSWORD_RESET_URL` to its verified HTTPS recovery page. The CMS cannot reset a public site password.

A separate, private staff website for editing LyricalSource articles. It does not connect to the public site's database. The CMS stores staff accounts and invitations in its own SQLite file and sends article changes to the site's authenticated publishing API.

See [PLAN.md](PLAN.md) for the shared Windows, macOS, and Linux app release plan and the remaining work.

## Run locally

With Docker installed, clone both repositories into the same parent directory:

```bash
git clone -b cms-integration https://github.com/petercodes07/lyricalsource.git
git clone https://github.com/petercodes07/lyricalsource-cms.git
cd lyricalsource-cms
npm ci
CMS_SUPERUSER_PASSWORD='your-local-password' npm run setup:local
docker compose up -d
```

The setup script creates ignored `.env.local` files for both apps and generates a matching API token. It does not overwrite existing environment files. Use the password supplied for the superuser when running setup. The superuser account is created only if it does not already exist; changing the environment variable later does not reset its password.

In one terminal, run `cd ../lyricalsource && npm ci && npm run dev`. In another, run `cd lyricalsource-cms && npm start` from the parent directory. Open `http://127.0.0.1:3100/login`. The CMS uses port 3100, the site uses port 3000, and Docker binds test MySQL to `127.0.0.1:3307`. The test database is initialized with the site's base schema and migrations.

Without Docker, create a compatible MySQL test database, apply the site's base schema followed by migrations 003 through 008 and 010, then set both apps' `.env.local` files from their examples. Never apply test setup scripts to a production database.

The CMS binds to `127.0.0.1` by default. For a private network deployment, set `HOST`, `CMS_BASE_URL`, HTTPS, and network access controls deliberately. The CMS server needs to reach `SITE_API_URL` when publishing. Keep `.env.local`, the SQLite file, and the API token out of Git.

## Roles

| Role | Drafts | Publish | Team |
| --- | --- | --- | --- |
| Superuser | All | Yes | Invite/manage owners, editors, authors |
| Owner | All | Yes | Invite/manage editors and authors |
| Editor | All | Yes | No |
| Author | Own drafts | No | No |

Owners and superusers create one-time invitations under **Team**. Invitations expire after 72 hours. Configure SMTP settings to send email; without SMTP, the CMS shows a copyable link. New members set their own password.

## Site integration

The site repository supplies `GET/POST /api/cms/articles`, `GET/PUT /api/cms/articles/:id`, and `POST /api/cms/media`. These routes require a bearer token stored only on the CMS server. Public article queries include only published rows. Apply the database migration **before** deploying the updated site code, since its queries expect the new `status` column.

Uploaded images are written by the site to `public/uploads/news/cms`. Ensure that directory is writable and retained across deployments. In a multi-server deployment, replace local file storage with shared object storage before enabling uploads.

## Tests

`npm test` exercises login, invitations, article drafting, publishing, and role restrictions against a mock site API. Run the public site's `npx tsc --noEmit` for its TypeScript checks. A live end-to-end test requires a MySQL database with the migration applied.

## Installable staff app

The CMS includes a standalone web-app manifest, 192/512 px icons, an installation
page at `/install`, a responsive workspace and an unsaved-edit warning. Staff use
one hosted server; no API token or staff database is distributed to clients.
Serve it over HTTPS (localhost is allowed for development). Install through a
supporting browser's menu or the **Get the app** page. Browser installation is
supported where available on Windows, macOS and Linux; there are no native
installers. See [MDN installation guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

There is intentionally no service worker or offline content cache. Editing is
online; the offline notice asks staff to keep the page open until connectivity
returns. Closing the page can lose unsaved work. Browser storage does not keep
private drafts. The UI provides a preview of the saved version. Inside a saved article, **View page on website** opens the website article layout. Drafts use a private signed link that expires after 15 minutes; reopen the editor for a fresh link. Save changes before viewing. The companion site must include the article-preview support; drafts remain excluded from public article queries.

**Save changes** preserves publication. **Save draft** on an older open form
also preserves a published article's status. **Unpublish article** is a separate
confirmed action available only to publishing roles. Authors cannot edit
published articles or unpublish. Concurrent editing still uses the site's
existing last-write behavior; version conflict handling is not implemented.

## Isolated preview

```bash
npm ci
npm run demo
```

Open `http://127.0.0.1:3100`. Demo login: `demo@example.com`, password
`local-demo-only-1234`. This starts a temporary SQLite database and a local mock
publishing API with sample articles. It overrides live API/SMTP settings, binds
only to loopback, and discards data on exit. Uploads are deliberately disabled in
the demo; validate those against a nonproduction site API. Never deploy the demo
command as a shared service.

## Hosted deployment

1. Deploy the companion site's CMS API after backing up its database and applying
   `db/010_cms_publishing.sql`. Verify article updates invalidate the public blog
   listing as well as news/article pages. This repository cannot change the site's
   revalidation behavior. Preserve the site's uploaded-media directory across
   releases (or use shared object storage).
2. Install this repository and dependencies under `/opt/lyricalsource-cms` on a
   host with a supported Node version. Create a dedicated `lyricalsource` system
   user and `/var/lib/lyricalsource-cms`, owned by that user. Use the tested runtime
   for rollout; this change was locally tested on Node 25.8.1.
3. Copy `deploy/cms.env.example` to `/etc/lyricalsource-cms.env`, set the real URLs,
   shared secret, bootstrap account and optional SMTP. Restrict file permissions
   to the service account. Remove the bootstrap password after creating the account.
4. Adapt `deploy/lyricalsource-cms.service` to your Node executable path. Install it
   with systemd and enable the service. Put an HTTPS reverse proxy in front;
   `deploy/Caddyfile.example` shows a configuration template. Keep port 3100 bound
   to loopback; use your intended staff network/access controls at the proxy.
5. Test invitation, login, draft, preview, upload, publish, update and unpublish
   against the actual migrated test site. Verify public visibility and media
   persistence across both services' restarts before production rollout.

The deployment templates have not been exercised on a hosting server. They do
not provision DNS, TLS, the companion site, or staff network access automatically.

## Backups and restore

Run `npm run backup -- /secure/backups/cms-YYYY-MM-DD.sqlite` as the service user,
with the same `CMS_ENV_FILE` as the service. The destination must be new and its
parent directory must exist. This uses SQLite's online backup API and checks the
copy's integrity, avoiding an unsafe copy of a database with an active WAL.
Protect backups as staff data and copy them to your approved backup storage.
Back up website content and uploaded images separately.

For a restore drill: stop the CMS, preserve its current database and any `-wal`
and `-shm` files as a recovery set, restore the verified backup to `CMS_DB_PATH`
with service-user ownership and restricted permissions, then restart. Do not
leave the previous WAL/SHM files alongside a restored database. Verify login,
article ownership, team roles and publishing API connectivity. Restoring the CMS
SQLite file alone does not restore article content on the website.

## Downloadable desktop app

The `desktop/` package is an Electron client with its own window and native
installer targets. It connects to the central CMS; it does not run Express,
ship SQLite, or contain the publishing API token. The browser-installable option
above remains optional; desktop staff do not need to install through a browser.

```bash
npm run desktop:setup
npm run desktop
```

Windows and Mac launch directly into the shared LyricalSource CMS at
`https://lyricalsourcecom.dbm.shared-servers.com/cms`. There is no workspace
address setup. Staff sign in with their username or email and password; sessions
are stored in the OS user profile. Remote CMS content has no Node or IPC access.
External HTTPS links require confirmation and open in the system browser.
Cross-origin redirects and unexpected permissions are blocked.

For local development, leave `npm run demo` running in one terminal and run
`npm run desktop:demo` in another. The HTTP loopback exception is available only
in an unpackaged development build with `--demo`. Packaged apps require HTTPS.

Build installers on the matching operating system:

```bash
npm run desktop:dist
```

Outputs are in `desktop/dist`: macOS DMG/ZIP, Windows NSIS EXE, Linux
AppImage/DEB. The manually triggered **Desktop installers** GitHub Actions
workflow builds these on the respective hosted runners, including Intel and
Apple Silicon macOS targets. It uploads artifacts without publishing a release.

Builds are unsigned development distributions until signing is configured.
Configure Apple Developer signing/notarization and Windows code signing before
external distribution; do not ask staff to bypass OS security warnings. The
workflow currently disables automatic certificate discovery for reproducibility.
There is no automatic updater yet: distribute tested new installers explicitly.
The hosted CMS must be available over HTTPS before these are useful to staff.
