#!/bin/bash
# Run as root after provisioning Node, nginx, a certificate and /etc/autopost secrets.
# Usage: bash deploy-release.sh /root/autopost-deploy/release.tar.gz
set -euo pipefail
test "$(id -u)" = 0
archive=$(realpath "${1:?Provide a release archive}")
release="/opt/autopost/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 755 "$release"
tar -xzf "$archive" --no-same-owner -C "$release"
test -f "$release/vps/server.mjs"
test -f "$release/dist-vps/client/index.html"
python3 "$release/vps/backup-workspace.py"
chmod -R u=rwX,go=rX "$release"
previous=$(readlink -f /opt/autopost/current || true)
ln -sfn "$release" /opt/autopost/current
install -m 644 "$release/vps/autopost.service" /etc/systemd/system/autopost.service
systemctl daemon-reload
systemctl enable autopost
systemctl restart autopost
ready=false
for attempt in $(seq 1 15); do
  if curl --fail --silent http://127.0.0.1:3000/healthz >/dev/null; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  if [ -n "$previous" ] && [ "$previous" != /opt/autopost/current ]; then
    ln -sfn "$previous" /opt/autopost/current
    systemctl restart autopost
  fi
  echo 'API startup failed; previous release restored when available.' >&2
  exit 1
fi
install -m 644 "$release/vps/nginx.conf" /etc/nginx/sites-available/autopost
ln -sfn /etc/nginx/sites-available/autopost /etc/nginx/sites-enabled/autopost
nginx -t
systemctl reload nginx
install -m 644 "$release/vps/autopost-cert-renew.service" /etc/systemd/system/autopost-cert-renew.service
install -m 644 "$release/vps/autopost-cert-renew.timer" /etc/systemd/system/autopost-cert-renew.timer
systemctl daemon-reload
systemctl enable --now autopost-cert-renew.timer
systemctl is-active autopost nginx autopost-cert-renew.timer
printf 'Active release: %s\n' "$release"
