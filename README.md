# LyricalSource CMS

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
