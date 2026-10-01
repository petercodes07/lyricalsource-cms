# CMS release plan

## Goal

Give staff one shared LyricalSource CMS that they can use on Windows, macOS, and Linux. Staff accounts, sessions, article ownership, and the publishing token stay on a centrally hosted CMS server. The client must never contain the publishing token or a copy of the staff database.

The first cross-platform delivery is an HTTPS web app with an installable app experience where the user's browser supports it. If downloadable desktop installers are required, package clients for Windows, macOS, and Linux that connect to the same hosted CMS. Desktop packages must not embed server secrets. Offline publishing is outside the current scope because the public site API must be reachable.

## Current state (2026-10-01)

- The CMS has staff login, password changes, role management, invitations, article drafting, preview, publishing, and image uploads.
- The CMS workflow test passes against a mock site API.
- The public site's authenticated CMS API, draft filtering, and migration are on the `cms-integration` branch of `petercodes07/lyricalsource`. That branch has a passing MySQL integration workflow, but is not merged into the site's `master` branch.
- The CMS is not deployed as a staff-facing service. A live end-to-end publishing test against the migrated site database is still needed.

## Work remaining

1. **Correct the editorial workflow.** Saving an edit to a published article currently sends `draft` status and unpublishes it. Make ordinary saves preserve the current status, and provide an explicit unpublish action. Revalidate the public `/blog` page when blog articles change. Add focused regression tests for these behaviors.
2. **Prepare the site deployment.** Review and merge the site's `cms-integration` branch without overwriting unrelated site work. Back up the database, apply `db/010_cms_publishing.sql` before deploying code that queries `status`, and configure the same `CMS_API_TOKEN` on the site and CMS servers.
3. **Deploy the shared CMS.** Run the CMS as a managed service behind HTTPS and staff access controls. Set its public base URL and site API URL. Keep the SQLite database and uploaded images on persistent storage, with tested backups and restore steps. Configure SMTP if invitations should arrive by email.
4. **Make the client installable.** Add an app manifest, icons, and appropriate install behavior for supported desktop browsers. Test login, editing, upload, preview, and publishing in current browsers on Windows, macOS, and Linux. Confirm whether downloadable desktop installers are also required before selecting a desktop wrapper and release pipeline.
5. **Verify the full system.** On a migrated nonproduction database, test invitation through login, author draft, editor publish, public visibility, updates, unpublish, image persistence, and restart recovery. Then repeat a controlled smoke test after deployment.

## Release criteria

- A staff member can open the same CMS on Windows, macOS, and Linux and see the same articles and team state.
- Drafts are private; publishing and unpublishing change public visibility without unintended status changes.
- Uploads, accounts, and sessions survive application restarts and deployments.
- The publishing token remains server-side, and the CMS is reachable only over HTTPS through the intended staff access path.
- The full workflow passes against the deployed site API and database, not only the mock API.
