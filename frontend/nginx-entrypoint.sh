#!/bin/sh
# Runs as /docker-entrypoint.d/05-ssl-config.sh inside the nginx container.
# Picks the right server block template and renders it via envsubst.
#
# Modes (evaluated in order):
#   HTTPS  — CERTS_DIR contains fullchain.pem + privkey.pem
#   HTTP   — everything else (SERVER_NAME defaults to _ for catch-all)
set -e

CERT_DIR="${CERTS_DIR:-/etc/nginx/certs}"
TMPL_DIR="/etc/nginx/86web-templates"
OUT="/etc/nginx/conf.d/server.conf"

export SERVER_NAME="${SERVER_NAME:-_}"

mkdir -p /etc/nginx/conf.d

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "[86web] SSL certs found in $CERT_DIR — enabling HTTPS (server_name: $SERVER_NAME)"
    envsubst '${SERVER_NAME}' < "$TMPL_DIR/https.conf.template" > "$OUT"
else
    echo "[86web] No SSL certs — serving HTTP (server_name: $SERVER_NAME)"
    envsubst '${SERVER_NAME}' < "$TMPL_DIR/http.conf.template" > "$OUT"
fi
