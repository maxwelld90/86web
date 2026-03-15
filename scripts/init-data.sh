#!/bin/bash
# Creates the data directory structure on the host before first run.
# Run this once: bash scripts/init-data.sh

set -e

# Source .env if it exists (look next to the script, then in cwd)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
[ -f "$ENV_FILE" ] && . "$ENV_FILE" && echo "Loaded .env from ${ENV_FILE}"
[ ! -f "$ENV_FILE" ] && [ -f .env ] && . .env && echo "Loaded .env from $(pwd)/.env"

PUID=${PUID:-1000}
PGID=${PGID:-1000}
DATA_PATH=${DATA_PATH:-./data}

echo "Creating 86Web data directories at: $DATA_PATH"
mkdir -p \
  "${DATA_PATH}/vms" \
  "${DATA_PATH}/roms" \
  "${DATA_PATH}/config" \
  "${DATA_PATH}/cache/86box"

echo "Setting ownership to ${PUID}:${PGID}"
chown -R "${PUID}:${PGID}" "${DATA_PATH}" 2>/dev/null || \
  echo "(chown skipped — run as root if ownership needs to be set)"

echo "Done. Directory structure:"
ls -la "${DATA_PATH}"
