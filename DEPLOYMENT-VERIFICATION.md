# Scaling deployment verification — October 2, 2026

Deployed to the existing LyricalSource website and CMS on the shared server. The active website build is `.next-scale-final-20261002`. Staff credentials and sign-in requirements remain unchanged.

- Seven automated test cases pass, including the existing login/invitation/role workflows plus queue saturation, timeout cancellation, cache coalescing, oversized-cache bypass, and conflict/presence checks.
- Next production build, TypeScript validation, and lint pass.
- A private temporary draft received two simultaneous saves with the same version: HTTP 200 and 409. Missing revisions also receive 409. The successful save increments the version once; no public article was published by the check.
- Stale song, album, and playlist saves each receive 409; a subsequent read confirms their original metadata and tracks are unchanged.
- Article filters, escaped wildcard search, song page separation, and all four CMS list limits pass against the actual database.
- A final HTTPS CMS probe passes 24 requests at concurrency four, covering articles, songs, albums, playlists, team, and account. The empty-body heartbeat used by the browser also passes. The final sample p95 is 504 ms and maximum is 589 ms, including HTTPS/proxy latency. These are smoke checks, not a capacity guarantee.
- Public home, news, news page two, playlists, and CMS login return HTTP 200.
- After the final probe, PM2 reports both services online: CMS about 93 MB RSS and website about 111 MB RSS. The server retains approximately 2.1 GB available RAM. Only these two application processes were restarted; other services were left running.
- Database content and source backups, the prior website build, and the old runtime wrapper are retained privately. Temporary test drafts, audit rows, sessions, and presence records were removed.

## Hosting certificate chain

The shared hostname serves its leaf certificate without the RapidSSL intermediate needed by strict TLS clients. The Mac's curl reaches the public login normally, but the server's default Node/curl trust path rejects the incomplete chain. For the encrypted probe, the intermediate was downloaded from DigiCert's HTTPS certificate repository and verified against the server's trusted CA bundle. It was supplied only to the verification command with NODE_EXTRA_CA_CERTS; TLS verification was not disabled and no application trust setting was changed.

The hosting/Nginx certificate configuration should serve the complete chain. That hosting-level issue remains outside these application changes and can affect clients that do not retrieve missing intermediates automatically.

## Remaining capacity limits

The local 20-staff/10,000-item mock-API benchmark is documented in SCALING.md. Production was deliberately checked with a small bounded burst to avoid competing with the server's other workloads. A promised capacity of thousands of simultaneous users requires a separate production-representative load test and likely more infrastructure. Substring searches and very deep offset pages still become more expensive with catalog growth. Real-time shared text editing and multiple CMS hosts are not implemented; staff get editor presence and transactional save-conflict protection.
