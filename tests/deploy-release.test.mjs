import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../deploy/spring/deploy-release.sh', import.meta.url), 'utf8');

test('release migrates rental cards after the backup and before it goes live', () => {
  const backup = script.indexOf('backup-workspace.py');
  const migrate = script.indexOf('--migrate-rental-drafts');
  const live = script.indexOf('ln -sfn "$release" /opt/autopost/current');
  assert.ok(backup > 0 && migrate > backup && live > migrate, 'backup → migration → switch');
  const start = script.indexOf('if [ -f /var/lib/autopost/workspace.sqlite ]');
  const command = script.slice(start, script.indexOf('\nfi', start));
  assert.ok(start > backup && command.includes('--migrate-rental-drafts'), 'only when a database exists');
  assert.match(command, /runuser -u autopost --/, 'runs as the service user that owns the database');
  assert.match(command, /--database=\/var\/lib\/autopost\/workspace\.sqlite/);
  assert.match(command, /--rental-reference=\$release\/data\/rental\/apartments_long_term_rent/);
});
