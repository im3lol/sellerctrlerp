# SaaS deployment

SellerCtrl is deployed as a self-hosted Next.js application with a separate background worker, PostgreSQL, Redis, private/public MinIO buckets, and an HTTPS reverse proxy. Use Node.js 22 and the versioned migration chain.

## Public hosts and authentication

Configure these environment variables for your own domain:

- `MARKETING_URL`: landing page and all sign-in pages.
- `APP_URL`: authenticated dashboards and platform administration.
- `STORAGE_PORTAL_URL`: authenticated organization files, exports, and backup management.
- `AUTH_COOKIE_DOMAIN`: the shared parent domain, for example `.example.com`.

Sessions use Secure, HttpOnly cookies. Public sign-in does not grant administration access; the server requires the platform administrator role. Organization pages and API actions retain membership, permission, entitlement, and row-level-security checks.

Never commit real environment files, OAuth secrets, session tokens, database dumps, organization exports, or customer audit reports. `.env.example` contains development placeholders only. Follow `docs/SECRET-ROTATION.md` for production secrets.

## Deploy

Use `npm run deploy` with the appropriate Compose configuration for your environment. For a VPS, combine `docker/docker-compose.yml` with `docker/docker-compose.vps.yml` through `COMPOSE_FILE`. Configure `APP_DOMAIN`, `MARKETING_DOMAIN`, `STORAGE_DOMAIN`, and `TLS_EMAIL`; use the Caddy service in the `edge` profile. Validate the configuration before enabling public traffic.

The supported order is: validate secrets, apply versioned migrations, apply RLS and integrity triggers, build the standalone application, rebuild both app and worker, then require healthy containers. Keep a prior image for code rollback. Additive schema changes do not require restoring an older business database to roll back code.

PostgreSQL, Redis, the object-store console, and the application container port should be loopback-only. Restrict SSH independently from public website access. See `VPS-SECURITY.md`.

## Organization backups and Google Drive

Company exports use a fresh tenant-scoped PostgreSQL repeatable-read, read-only transaction. Snapshot reads finish before conversion or external uploads. Daily backup failures persist health, emit a sanitized error alert, and propagate to the worker queue for retry.

The storage portal supports permitted table exports, attachments, item-image lookup, saved backups, and Google Drive jobs. Drive snapshots contain gzipped JSON plus independent readable Sheets files and a summary inside a dated folder. Attachment binaries are separate. Operational credentials and cloud-job state are excluded from customer exports.

Drive jobs run in the worker and retain progress and a private immutable snapshot. Closing the page does not cancel an upload; failed tasks can resume missing files. The same verified Google account/folder can be reused on reconnection. Daily scheduling is opt-in after 03:00 Africa/Cairo. Retention defaults to keep all; an optional limit applies only to new managed completed folders and moves older ones to Drive trash. Legacy folders are not removed by this policy.

Local full database/object backups and organization Drive exports serve different recovery purposes. Storing all full backups on one VPS does not protect against losing that VPS. Choose a recovery policy appropriate to your deployment and test restoration on an isolated database. Keep encryption keys separately protected; they are needed to restore encrypted integration settings.

## Printing and mobile operation

Administration has a responsive side drawer. Backup timestamps use Africa/Cairo. The application uses the light theme and optimized brand assets on desktop and mobile.

Label batches use one native browser print dialog with an installed printer driver. Paper dimensions and alignment can be saved per browser at `/settings/printing`. Use the same paper size in the driver, 100% scale, and no margins/headers/footers. Print and scan the supplied test label before a production batch; rendering tests do not certify physical cutting or scanning on every printer model.
