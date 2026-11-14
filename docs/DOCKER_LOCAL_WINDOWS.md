# Local Docker on Windows

The local stack is available at http://localhost:3001. It uses the credentials in
the ignored root `.env`, and persistent Docker volumes. The initial empty database
was migrated, had RLS applied, and was populated with `db/seed.ts`.

Demo login: `admin` / `password123`.

Start or stop the existing stack from the repository root:

```powershell
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.local.yml --profile app up -d app worker minio-init
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.local.yml --profile app stop
```

Rebuild after source changes (apply any new database migrations and RLS before
starting the new containers, as described in README.md):

```powershell
$env:NODE_ENV = 'production'
$env:NEXT_BUILD_DIR = '.next-local'
$env:NODE_OPTIONS = '--max-old-space-size=6144'
node node_modules/next/dist/bin/next build
# Continue only if the build exits successfully.
Copy-Item .next-local/static .next-local/standalone/.next-local/ -Recurse -Force
Copy-Item public .next-local/standalone/ -Recurse -Force
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.local.yml --profile app up -d --build app worker minio-init
```

The separate build directory avoids inherited ACLs on the copied `.next` folder.
The local override pins the community-maintained `pgsty/minio` and `pgsty/mc`
images by digest because the original MinIO images could not be pulled from
Docker Hub or Quay. See https://hub.docker.com/r/pgsty/minio and
https://hub.docker.com/r/pgsty/mc for their provenance and compatibility notes.
Production Compose defaults are unchanged. The local override sets the application
origin to localhost and starts only the requested services.

Review validation: the production build and its TypeScript check passed. Vitest
reported 1178 passing tests and 3 failures in `lib/i18n/__tests__/coverage.test.ts`:
mobile dictionary synchronization, the missing `اختيار` UI translation, and the
Arabic digit-normalization literal in `clipboard-grid.ts` flagged as untranslated.

Runtime verification passed: all five long-running services are healthy; both web
and worker health endpoints report DB and Redis up, with the worker heartbeat up.
The demo credentials successfully created an authenticated session. Login, a static
JavaScript asset, dashboard, inventory items, sales orders, purchase orders and the
chart of accounts all returned HTTP 200.
