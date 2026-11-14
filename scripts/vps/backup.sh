#!/bin/sh
# VPS replacement for the DB-only sidecar. Failed offsite copies are never "ok".
set -eu
umask 077
export PATH="/toolbin:$PATH"
offsite=0
if [ -n "${OFFSITE_S3_BUCKET:-}" ]; then
    : "${OFFSITE_S3_ENDPOINT:?offsite HTTPS endpoint required}"
    : "${AWS_ACCESS_KEY_ID:?offsite key required}"
    : "${AWS_SECRET_ACCESS_KEY:?offsite secret required}"
    case "$OFFSITE_S3_ENDPOINT" in https://*) ;; *) echo 'Offsite requires HTTPS'; exit 1;; esac
    offsite=1
elif [ "${BACKUP_REQUIRE_OFFSITE:-1}" != 0 ]; then
    echo '[backup] offsite configuration required (local-only must be explicitly enabled)'
    exit 1
fi
mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
if [ "$offsite" = 1 ]; then
    mc alias set offsite "$OFFSITE_S3_ENDPOINT" "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" >/dev/null
fi
while true; do
    stamp=$(date -u +%Y%m%d-%H%M%S)
    file="/backups/sellerctrl-$stamp.dump"
    # Write atomically so restore tools never select a partial dump.
    pg_dump -h postgres -U sellerctrl -Fc -Z9 --no-owner --no-privileges sellerctrl -f "$file.partial"
    pg_restore --list "$file.partial" >/dev/null
    mv "$file.partial" "$file"
    if [ "$offsite" = 1 ]; then mc cp "$file" "offsite/$OFFSITE_S3_BUCKET/pg/"; fi
    # Date-isolated snapshots preserve objects deleted from the live buckets.
    for bucket in sellerctrl sellerctrl-private; do
        if [ "$offsite" = 1 ]; then
            mc mirror "source/$bucket" "offsite/$OFFSITE_S3_BUCKET/objects/$stamp/$bucket/"
        else
            mc mirror "source/$bucket" "/backups/objects/$stamp/$bucket/"
        fi
    done
    touch /backups/last-backup-success
    if [ "$offsite" = 1 ]; then
        touch /backups/last-offsite-success
        echo "[backup] database and objects offsite ok: $stamp"
    else
        echo "[backup] LOCAL ONLY database and objects ok: $stamp; offsite NOT configured"
    fi
    find /backups -name 'sellerctrl-*.dump' -mtime +14 -delete
    if [ "$offsite" = 0 ] && [ -d /backups/objects ]; then
        find /backups/objects -mindepth 1 -maxdepth 1 -type d -name '20??????-??????' -mtime +14 -exec rm -rf -- {} \;
    fi
    sleep 86400
done
