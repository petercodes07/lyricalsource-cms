# Shared-server scaling and staff collaboration

Implemented October 2, 2026 for the existing two-CPU, roughly 4-GB server shared with other applications.

## Resource budgets

- Website MySQL pool: six connections, at most 64 queued requests, two idle connections, five-second connection timeout.
- CMS outgoing site calls: six active, 64 queued, five-second queue wait, 15-second request deadline. Writes are never retried automatically.
- Password work: two asynchronous scrypt jobs, 32 waiters. Password formats and staff credentials are unchanged. There is no new minimum password length.
- Article uploads/saves: two active, eight waiters; one image up to 5 MB, limited form fields and size. The slot lasts until the response completes.
- Website memory cache: 500 records, a 16-MB estimated retained-data budget, at most 1 MB per record, and 128 coalesced loaders. Simultaneous requests for the same data reuse one loader. Failed loads are not cached; invalidation cannot resurrect stale data. Random search and tag queries use bounded memory rather than creating permanent cache files.
- CMS lists: 50 articles, songs, albums, playlists, or staff per page. Filters and article ownership run in SQL. Failed playlist saves use one song lookup rather than hundreds of requests. Playlist association writes are batched.
- Public news and playlist lists query only their page. News summaries omit full article bodies. Cache invalidation follows content dependencies instead of clearing the entire site on every save.
- Expired sessions/presence are cleaned every minute; login attempt records expire and are capped. Indexed staff/session/ownership lookups avoid table scans.
- PM2 CMS: one process, 192-MB V8 old-space target, 384-MB restart threshold, graceful shutdown, 20-second termination allowance. Website: 320-MB old-space target and 512-MB restart threshold. PM2 thresholds are watchdogs, not hard operating-system memory reservations. No extra worker, Redis, or background service was added.

## Collaboration

Articles, songs, albums, and playlists carry a database edit version. Saving, publishing, or unpublishing a stale version returns 409 without overwriting the newer content. The submitted form is kept, an unsaved-content warning remains active, and a link opens the latest version in another tab. Review and reconcile changes before saving again.

An open editor sends a small heartbeat every 30 seconds while visible and online. It shows the names of other staff editing that item. Presence expires after 75 seconds and is bounded to ten document locations per staff account. This is a presence indicator and conflict protection, not simultaneous Google Docs-style text editing. Staff permissions remain enforced.

## Verification and practical limits

`npm test` covers login, invitation reuse, roles, prefixed workspace routing, backups, simultaneous saves, presence permissions, queue saturation/timeouts, and stale-cache invalidation. `node --max-old-space-size=192 scripts/benchmark-cms.js` creates isolated temporary data and checks 20 staff logins plus 100 list requests at concurrency 20 against a mock API representing a 10,000-item catalog. It does not touch production or measure MySQL capacity.

Local smoke result: all 100 requests passed; list p95 58 ms, maximum sampled event-loop delay 22 ms, end RSS 197 MB. These numbers are from the Mac with a mock site API and do not establish a production user limit.

The server deployment also uses a real private draft to verify one winner/one conflict under concurrent API saves, rejects stale updates across all four content types, and performs a small read-only HTTP burst. Details are recorded in the deployment verification report. Backups and the prior website build are retained privately on the server.

For substantially more traffic, measure real production request rates, database latency, queue rejections, event-loop delay, memory, and disk growth before raising limits. Search with substring matching and deep OFFSET pagination still cost more as the catalog grows. Multiple CMS hosts, real-time shared text editing, and a guaranteed thousands-of-users capacity require additional infrastructure and testing; this deployment does not claim those capabilities.
