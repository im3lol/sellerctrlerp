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
DC() { ( cd docker && docker compose --profile app "$@" ); }

echo "▶ 1/6  host build (heap 8G)…"
NODE_OPTIONS="--max-old-space-size=8192" npm run build

echo "▶ 2/6  copy static + public into standalone…"
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

echo "▶ 3/6  apply policies + integrity triggers (idempotent, safe on live data)…"
# NOTE: schema changes are a REVIEWED pre-step, not auto-applied here — never run
# `push --force` against the live-data DB blind. If you changed db/schema.ts, run
# `npx drizzle-kit push` first, review the diff, apply it, THEN deploy. (CI proves the
# schema applies cleanly on a fresh DB, so a broken schema is caught before this point.)
npm run db:rls

echo "▶ 4/6  tag the running image for rollback…"
PREV="$(docker inspect sellerctrl-app --format '{{.Image}}' 2>/dev/null || true)"
if [ -n "$PREV" ]; then docker tag "$PREV" sellerctrl-app:rollback && echo "    saved $PREV → sellerctrl-app:rollback"; fi

echo "▶ 5/6  build + swap…"
DC up -d --build

echo "▶ 6/6  health gate…"
ok=""
for i in $(seq 1 20); do
  s="$(docker inspect --format '{{.State.Health.Status}}' sellerctrl-app 2>/dev/null || echo none)"
  if [ "$s" = "healthy" ]; then ok=1; break; fi
  sleep 6
done

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
