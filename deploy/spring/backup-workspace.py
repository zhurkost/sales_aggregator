"""Online SQLite backup, including committed WAL data. Run as root on the VPS."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

source = Path('/var/lib/autopost/workspace.sqlite')
if source.is_file():
    directory = Path('/root/autopost-backups')
    directory.mkdir(mode=0o700, exist_ok=True)
    target = directory / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sqlite')
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as original:
        with sqlite3.connect(target) as backup:
            original.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')
    print('Workspace backup created and verified.')
