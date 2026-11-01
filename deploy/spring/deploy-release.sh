#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
archive=$(realpath "${1:?Provide the Angular/Spring release archive}")
test -x /usr/bin/java
major=$(/usr/bin/java -version 2>&1 | head -n 1 | sed -E 's/.*version "([0-9]+).*/\1/')
[[ "$major" =~ ^[0-9]+$ ]] && test "$major" -ge 17
release="/opt/autopost/releases/$(date -u +%Y%m%dT%H%M%SZ)-spring"
install -d -m 755 "$release"
tar -xzf "$archive" --no-same-owner -C "$release"
test -f "$release/backend/target/autopost-api.jar"
test -f "$release/dist-angular/browser/index.html"
python3 "$release/deploy/spring/backup-workspace.py"
chmod -R u=rwX,go=rX "$release"
previous=$(readlink -f /opt/autopost/current || true)
backup=$(mktemp -d /root/autopost-config-backup.XXXXXX)
cp -a /etc/systemd/system/autopost.service "$backup/autopost.service"
cp -a /etc/nginx/sites-available/autopost "$backup/nginx.conf"
rollback() {
  trap - ERR
  if [ -n "$previous" ]; then ln -sfn "$previous" /opt/autopost/current; fi
  cp -a "$backup/autopost.service" /etc/systemd/system/autopost.service
  cp -a "$backup/nginx.conf" /etc/nginx/sites-available/autopost
  systemctl daemon-reload
  systemctl restart autopost
  nginx -t && systemctl reload nginx
  echo 'Deployment failed. Previous application and server configuration restored.' >&2
}
trap rollback ERR
ln -sfn "$release" /opt/autopost/current
install -m 644 "$release/deploy/spring/autopost.service" /etc/systemd/system/autopost.service
systemctl daemon-reload
systemctl restart autopost
ready=false
for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3000/healthz >/dev/null; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
install -m 644 "$release/deploy/spring/nginx.conf" /etc/nginx/sites-available/autopost
nginx -t
systemctl reload nginx
systemctl is-active autopost nginx
trap - ERR
printf 'Active release: %s\nPrevious release: %s\nConfiguration backup: %s\n' "$release" "$previous" "$backup"
