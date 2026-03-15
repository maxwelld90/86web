#!/bin/bash
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "[86Web Runner] Starting with UID=${PUID} GID=${PGID}"

# Create group/user if they don't exist
if ! getent group "$PGID" > /dev/null 2>&1; then
    groupadd -g "$PGID" app86web
fi
if ! getent passwd "$PUID" > /dev/null 2>&1; then
    useradd -u "$PUID" -g "$PGID" -M -s /bin/bash app86web
fi

# Ensure machine-id exists — PulseAudio requires it; Docker containers often lack it
if [ ! -s /etc/machine-id ]; then
    cat /proc/sys/kernel/random/uuid | tr -d '-' > /etc/machine-id
fi

# Create required data directories
DATA_DIRS="/data /data/vms /data/roms /data/config /data/cache /data/cache/86box"
for dir in $DATA_DIRS; do
    mkdir -p "$dir"
    chown "$PUID:$PGID" "$dir"
done

# Fix /tmp for Xvfb
chmod 1777 /tmp

# Allow the app user to run /sbin/ip as root for bridge/TAP management.
# 86Box no longer needs sudo — CAP_NET_RAW is granted via cap_wrap ambient caps.
{
  echo "#${PUID} ALL=(root) NOPASSWD: /sbin/ip"
} > /etc/sudoers.d/86web-net
chmod 0440 /etc/sudoers.d/86web-net

echo "[86Web Runner] Running startup update check as UID=${PUID}..."
gosu "$PUID:$PGID" python3 /app/app/startup.py || echo "[86Web Runner] WARNING: update check failed (continuing)"

# Strip any file capabilities from the 86Box binary.  File capabilities on the
# AppImage clear the ambient capability set during exec(), preventing cap_wrap's
# NET_RAW/NET_ADMIN ambient caps from reaching 86Box's inner process.
if [ -x "/data/cache/86box/86Box" ]; then
    setcap -r /data/cache/86box/86Box 2>/dev/null || true
fi

echo "[86Web Runner] Dropping to UID=${PUID}"
exec gosu "$PUID:$PGID" "$@"
