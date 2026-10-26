import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

mkdirSync('work', {recursive:true});
execFileSync('tar', ['-czf', 'work/autopost-vps.tar.gz',
  'package.json', 'vps', 'app/api/analyze/route.ts', 'app/api/ai-settings/route.ts',
  'lib/ai-context.ts', 'lib/ai-prompt.ts', 'lib/listing.ts', 'dist-vps/client'], {stdio:'inherit', windowsHide:true});
console.log('VPS release: work/autopost-vps.tar.gz (no credentials or node_modules)');
