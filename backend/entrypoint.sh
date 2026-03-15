#!/bin/bash
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "[86Web Backend] Starting with UID=${PUID} GID=${PGID}"

# Create group/user if they don't exist
if ! getent group "$PGID" > /dev/null 2>&1; then
    groupadd -g "$PGID" app86web
fi
if ! getent passwd "$PUID" > /dev/null 2>&1; then
    useradd -u "$PUID" -g "$PGID" -M -s /bin/bash app86web
fi

# Create required data directories
DATA_DIRS="/data /data/vms /data/roms /data/config /data/cache"
for dir in $DATA_DIRS; do
    mkdir -p "$dir"
    chown "$PUID:$PGID" "$dir"
done

# Fix ownership of /app
chown -R "$PUID:$PGID" /app

echo "[86Web Backend] Dropping to UID=${PUID}"
exec gosu "$PUID:$PGID" "$@"
