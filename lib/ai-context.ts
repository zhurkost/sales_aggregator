import {AsyncLocalStorage} from 'node:async_hooks';
export type AISettings={AI_API_KEY?:string;AI_PROVIDER?:string;AI_MODEL?:string};
const settings=new AsyncLocalStorage<AISettings>();
export function runWithAISettings<T>(value:AISettings,run:()=>T):T{return settings.run(value,run);}
export function getAISettings():AISettings{return settings.getStore()||{};}
export function isAuthorized(request:Request){const host=new URL(request.url).hostname;return !!request.headers.get('oai-authenticated-user-id')||host==='localhost'||host==='127.0.0.1';}
