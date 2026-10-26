import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createServer} from 'vite';
import {createApiServer} from '../vps/server.mjs';

// Both listeners are loopback-only. The proxy credential never reaches client assets.
const local=existsSync('.dev.vars')?parseEnv(readFileSync('.dev.vars','utf8')):{};
const config={...local,...process.env,PUBLIC_ORIGIN:'http://127.0.0.1:5173',VPS_PROXY_SECRET:randomBytes(32).toString('hex'),DATA_DIR:'work/local-data'};
const api=createApiServer(config);
await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(0,'127.0.0.1',resolve);});
const app=await createServer({configFile:'vite.vps.config.ts',server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${api.address().port}`,headers:{'X-Autopost-Proxy-Secret':config.VPS_PROXY_SECRET}}}}});
try{await app.listen();app.printUrls();}catch(error){api.close();throw error;}
const close=async()=>{await app.close();api.close(()=>process.exit(0));};
process.on('SIGINT',close);process.on('SIGTERM',close);
