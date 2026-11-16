#!/usr/bin/env bash
# Backs up the CALIX settings store (docs/admin-panel-runbook.md §5).
#
#   deploy/backup-settings.sh /var/lib/calix/settings /var/backups/calix [keep]
#
# Writes settings-YYYYmmddTHHMMSSZ.tar.gz (mode 600) and keeps the newest `keep` archives (default
# 30). Safe while the site runs: every store file is replaced by an atomic rename, so each file in
# the archive is complete. The archive is listed (verified) before it counts as a backup; on any
# failure the partial file is removed and the script exits non-zero, so cron can report it.
#
# The archive contains the encrypted Telegram token and the administrators' password hashes: store
# it as carefully as the server itself. It does NOT contain SETTINGS_ENCRYPTION_KEY or
# SESSION_SECRET; back those up separately (a restore needs the same key).
set -euo pipefail
src="${1:?settings directory}"
dest="${2:?backup directory}"
keep="${3:-30}"
umask 077
mkdir -p "$dest"
if [ ! -d "$src" ]; then
  echo "backup: $src is not a directory; nothing was written" >&2
  exit 1
fi
stamp="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
out="$dest/settings-$stamp.tar.gz"
partial="$out.partial"
trap 'rm -f -- "$partial"' EXIT

tar -C "$src" --exclude='*.lock' --exclude='*.lock.reclaim-*' --exclude='.*.tmp' --exclude='.probe-*' --exclude='./instances' --exclude='./pre-restore-*' --exclude='./.restore-*' --exclude='./restore.json' -czf "$partial" .
if ! tar -tzf "$partial" >/dev/null 2>&1; then
  echo "backup: the archive did not verify; nothing was kept" >&2
  exit 1
fi
mv -- "$partial" "$out"
trap - EXIT

# Names sort by time; keep the newest `keep`.
ls -1 "$dest"/settings-*.tar.gz 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | xargs -r rm -f --
echo "$out"
