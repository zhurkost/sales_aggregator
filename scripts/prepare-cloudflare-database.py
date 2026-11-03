"""Prepare a private D1 import from a consistent SQLite backup; never touches live data."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path, help='Consistent backup, not a live SQLite database')
parser.add_argument('output', type=Path, help='Private, ignored output directory')
args = parser.parse_args()
source = args.source.resolve(strict=True)
output = args.output.resolve()
allowed = (Path.cwd() / 'work').resolve()
if not output.is_relative_to(allowed):
    raise SystemExit('Output must stay in this checkout\'s ignored work directory.')
output.mkdir(parents=True, exist_ok=True)
db = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
    raise SystemExit('Source database integrity check failed.')
if db.execute('PRAGMA foreign_key_check').fetchall():
    raise SystemExit('Source contains foreign key violations.')
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]

def quoted(name):
    return '"' + name.replace('"', '""') + '"'

statements = []
for statement in db.iterdump():
    if statement in ('BEGIN TRANSACTION;', 'COMMIT;'):
        continue
    # A new origin requires a fresh login. Password hashes and account IDs remain intact.
    if statement.startswith('INSERT INTO "sessions"'):
        continue
    statements.append(statement)
sql = '\n'.join(statements) + '\n'

verification = sqlite3.connect(':memory:')
verification.executescript(sql)
if verification.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
    raise SystemExit('Export round-trip integrity check failed.')
if verification.execute('PRAGMA foreign_key_check').fetchall():
    raise SystemExit('Export round-trip foreign key check failed.')
report = {'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sessionsMigrated': False, 'tables': {}}
for table in tables:
    original = db.execute('SELECT * FROM ' + quoted(table)).fetchall()
    restored = verification.execute('SELECT * FROM ' + quoted(table)).fetchall()
    if table == 'sessions':
        if restored:
            raise SystemExit('Session data unexpectedly present in export.')
    elif sorted(original, key=repr) != sorted(restored, key=repr):
        raise SystemExit('Round-trip mismatch: ' + table)
    report['tables'][table] = {'sourceRows': len(original), 'exportedRows': len(restored)}
report['sqlSha256'] = hashlib.sha256(sql.encode('utf-8')).hexdigest()
report['sqlBytes'] = len(sql.encode('utf-8'))
# D1 limits SQL text to 100 KB; existing ad JSON exceeds that when inlined.
# Export bound statements instead of uploading the literal SQLite dump.
requests = [{'sql': row[0], 'params': []} for row in db.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name")]
pending = set(tables)
ordered = []
while pending:
    ready = [name for name in sorted(pending) if all(
        fk[2] not in pending for fk in db.execute('PRAGMA foreign_key_list(' + quoted(name) + ')'))]
    if not ready:
        raise SystemExit('Cyclic foreign keys require a reviewed migration.')
    ordered.extend(ready)
    pending.difference_update(ready)
for table in ordered:
    if table == 'sessions':
        continue
    columns = [r[1] for r in db.execute('PRAGMA table_info(' + quoted(table) + ')')]
    insert = 'INSERT INTO ' + quoted(table) + '(' + ','.join(map(quoted, columns)) + ') VALUES(' + ','.join('?' for _ in columns) + ')'
    for row in db.execute('SELECT * FROM ' + quoted(table)):
        if any(isinstance(value, bytes) for value in row):
            raise SystemExit('Binary values require an explicit D1 binding conversion.')
        if sum(len(value.encode('utf-8')) if isinstance(value, str) else 8 for value in row) > 1_900_000:
            raise SystemExit('Row approaches D1 2 MB limit: ' + table)
        requests.append({'sql': insert, 'params': list(row)})
requests.extend({'sql': row[0], 'params': []} for row in db.execute(
    "SELECT sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name"))
bound_check = sqlite3.connect(':memory:')
bound_check.execute('PRAGMA foreign_keys=ON')
for request in requests:
    if len(request['sql'].encode('utf-8')) >= 100_000 or len(request['params']) > 100:
        raise SystemExit('Statement exceeds D1 limits.')
    bound_check.execute(request['sql'], request['params'])
for table in tables:
    if sorted(bound_check.execute('SELECT * FROM ' + quoted(table)).fetchall(), key=repr) != sorted(verification.execute('SELECT * FROM ' + quoted(table)).fetchall(), key=repr):
        raise SystemExit('Bound export mismatch: ' + table)
bound_check.close()
serialized = json.dumps(requests, ensure_ascii=False)
report['boundStatements'] = len(requests)
report['boundSha256'] = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
(output / 'bound-import.json').write_text(serialized, encoding='utf-8')
(output / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
db.close()
verification.close()
print(json.dumps(report, indent=2))
