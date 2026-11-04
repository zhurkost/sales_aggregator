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
/usr/bin/java -jar "$release/backend/target/autopost-api.jar" \
  "--validate-rental-reference=$release/data/rental/apartments_long_term_rent"
python3 "$release/deploy/spring/backup-workspace.py"
chmod -R u=rwX,go=rX "$release"
# Rental cards of an older card model are converted once, with this release's bundle,
# before it goes live. The service user keeps the SQLite files' owner; every card is
# written with its expected revision, so saves of the running release are not lost.
if [ -f /var/lib/autopost/workspace.sqlite ]; then
  runuser -u autopost -- /usr/bin/java -jar "$release/backend/target/autopost-api.jar" \
    --migrate-rental-drafts --database=/var/lib/autopost/workspace.sqlite \
    "--rental-reference=$release/data/rental/apartments_long_term_rent"
fi
previous=$(readlink -f /opt/autopost/current || true)
backup=$(mktemp -d /root/autopost-config-backup.XXXXXX)
cp -a /etc/systemd/system/autopost.service "$backup/autopost.service"
cp -a /etc/nginx/sites-available/autopost "$backup/nginx.conf"
cp -a /etc/autopost/environment "$backup/environment"
rollback() {
  trap - ERR
  if [ -n "$previous" ]; then ln -sfn "$previous" /opt/autopost/current; fi
  cp -a "$backup/autopost.service" /etc/systemd/system/autopost.service
  cp -a "$backup/nginx.conf" /etc/nginx/sites-available/autopost
  cp -a "$backup/environment" /etc/autopost/environment
  systemctl daemon-reload
  systemctl restart autopost
  nginx -t && systemctl reload nginx
  echo 'Deployment failed. Previous application and server configuration restored.' >&2
}
trap rollback ERR
python3 - <<'PY'
from pathlib import Path
import os
path = Path('/etc/autopost/environment')
lines = [line for line in path.read_text().splitlines() if not line.startswith('RENTAL_REFERENCE_DIR=')]
lines.append('RENTAL_REFERENCE_DIR=/opt/autopost/current/data/rental/apartments_long_term_rent')
path.write_text('\n'.join(lines) + '\n')
os.chmod(path, 0o600)
PY
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
