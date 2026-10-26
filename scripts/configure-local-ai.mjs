import {readFileSync,writeFileSync} from 'node:fs';
const key=readFileSync(process.argv[2],'utf8').trim();
if(!/^sk-or-v1-[A-Za-z0-9]+$/.test(key))throw new Error('Unexpected OpenRouter key format.');
// Local development secret file is ignored by Git and never bundled into assets.
writeFileSync('.dev.vars',`AI_API_KEY=${JSON.stringify(key)}\nAI_PROVIDER=openrouter\nAI_MODEL=deepseek/deepseek-v4.1-flash-1017\n`,{mode:0o600});
console.log('Local OpenRouter configuration saved to ignored .dev.vars.');
