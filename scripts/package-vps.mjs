import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

mkdirSync('work', {recursive:true});
execFileSync('tar', ['-czf', 'work/autopost-vps.tar.gz',
  'package.json', 'vps', 'app/api/analyze/route.ts', 'app/api/ai-settings/route.ts',
  'lib/ai-context.ts', 'lib/ai-prompt.ts', 'lib/price-identification.ts', 'lib/field-rules.ts', 'lib/attributes.ts', 'lib/extension-config.ts', 'lib/listing.ts', 'lib/platforms.ts', 'lib/taxonomy.ts', 'lib/batch-edit.ts', 'lib/seller-template.ts', 'data', 'dist-vps/client'], {stdio:'inherit', windowsHide:true});
console.log('VPS release: work/autopost-vps.tar.gz (no credentials or node_modules)');
