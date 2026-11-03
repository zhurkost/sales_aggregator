import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const artifact = resolve('backend/target/autopost-api.jar');
if (!existsSync(artifact)) throw new Error('Build the Spring application first: npm run build:backend');
const target = resolve('work/cloudflare-container');
mkdirSync(target, { recursive: true });
// Refuse an unexpected build context instead of accidentally uploading private files.
const allowed = new Set(['Dockerfile', 'autopost-api.jar']);
for (const name of readdirSync(target)) {
  if (!allowed.has(name) || !statSync(resolve(target, name)).isFile()) {
    throw new Error(`Unexpected file in Cloudflare image context: ${name}`);
  }
}
copyFileSync(artifact, resolve(target, 'autopost-api.jar'));
copyFileSync(resolve('deploy/cloudflare/Dockerfile'), resolve(target, 'Dockerfile'));
console.log('Prepared isolated image context: work/cloudflare-container (application only).');
console.log('Do not enable production writes until durable storage and recovery are verified.');
