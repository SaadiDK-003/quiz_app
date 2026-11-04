#!/bin/sh
set -eu
umask 077
mkdir -p /backups
while :; do
 stamp=$(date -u +%Y%m%dT%H%M%SZ)
 if pg_dump -Fc --file="/backups/database-$stamp.dump.tmp"; then
  mv "/backups/database-$stamp.dump.tmp" "/backups/database-$stamp.dump"
  tar -czf "/backups/media-$stamp.tar.gz.tmp" -C /media .
  mv "/backups/media-$stamp.tar.gz.tmp" "/backups/media-$stamp.tar.gz"
  printf '%s\n' "Backup complete: $stamp"
 else
  printf '%s\n' 'Database backup failed' >&2
  exit 1
 fi
 if [ "${BACKUP_ONCE:-0}" = "1" ]; then exit 0; fi
 sleep 86400
done
