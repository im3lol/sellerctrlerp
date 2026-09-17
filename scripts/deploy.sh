#!/usr/bin/env bash
# One-shot prod deploy for the local docker stack (app.sellerctrl.com → :3001).
# Replaces the copy-paste block: host build → copy static → apply schema+RLS (in the
# right order, before the swap) → tag the current image for rollback → swap → HEALTH
# GATE. If the new container isn't healthy in time it does NOT silently leave a broken
# deploy: it auto-rolls back to the previous image. Migrations are additive (expand /
# contract), so rolling the CODE back while keeping the pushed schema is safe.
#
#   bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# The application containers already receive this file through Compose's `env_file`,
# but the host-side preflight and Compose interpolation need it too. Loading it once
# makes all three phases validate and use the exact same deployment configuration.
if [ ! -f .env ]; then
  echo "❌ missing .env — deployment secrets must be supplied on the host."
  exit 1
fi
set -a
. ./.env
set +a

DC() { ( cd docker && docker compose --env-file ../.env --profile app "$@" ); }

echo "▶ 1/7  production environment preflight…"
npm run env:production:check

echo "▶ 2/7  host build (heap 8G)…"
# Always build cold. A build that starts from the previous build's Turbopack cache
# deadlocks right after spawning its PostCSS workers — idle CPU, no .next writes, forever
# (deploy24/25/27, 2026-09-14). A cold build compiles in ~4 min, faster than the old warm ones.
rm -rf .next/cache/turbopack
NODE_OPTIONS="--max-old-space-size=8192" npm run build

echo "▶ 3/7  copy static + public into standalone…"
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

echo "▶ 4/7  apply schema + policies + integrity triggers (idempotent, safe on live data)…"
# Migrations are additive and idempotent, so applying them before the swap is safe: the
# old code keeps running against the new schema until the container swaps.
# NEVER `drizzle-kit push` against this DB — it changes the schema without recording a
# migration, and that drift is invisible until a fresh deploy comes up missing columns.
# A DB built by the old push flow needs `npm run db:baseline` once first (see ARCHITECTURE).
npm run db:migrate
npm run db:rls

echo "▶ 5/7  tag the running image for rollback…"
PREV="$(docker inspect sellerctrl-app --format '{{.Image}}' 2>/dev/null || true)"
if [ -n "$PREV" ]; then docker tag "$PREV" sellerctrl-app:rollback && echo "    saved $PREV → sellerctrl-app:rollback"; fi

echo "▶ 6/7  build + swap…"
DC up -d --build

echo "▶ 7/7  health gate…"
# BOTH containers. `DC up -d --build` (no service argument) rebuilds every service in the
# profile, so the worker is always redeployed with the app — but the gate used to watch
# only the app, so a worker that failed to come up went unreported. A silently stale or
# dead worker means marketplace syncs keep running old code while everything looks fine.
ok=""
for i in $(seq 1 20); do
  a="$(docker inspect --format '{{.State.Health.Status}}' sellerctrl-app 2>/dev/null || echo none)"
  w="$(docker inspect --format '{{.State.Health.Status}}' sellerctrl-worker 2>/dev/null || echo none)"
  if [ "$a" = "healthy" ] && [ "$w" = "healthy" ]; then ok=1; break; fi
  sleep 6
done
echo "    app=$a worker=$w"

if [ -n "$ok" ]; then
  echo "✅ deployed and healthy."
  exit 0
fi

echo "❌ new container did not become healthy — ROLLING BACK"
if [ -n "$PREV" ]; then
  # Re-point the app/worker services at the previous image and restart without rebuilding.
  docker tag sellerctrl-app:rollback sellerctrl-app:latest || true
  DC up -d --no-build || true
  echo "↩️  rolled back to the previous image. Investigate the build, then re-run deploy.sh."
else
  echo "⚠️  no previous image to roll back to. Fix forward: git revert the bad commit and re-run."
fi
exit 1
