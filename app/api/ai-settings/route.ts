import {getAISettings,isAuthorized} from '../../../lib/ai-context.ts';
export function GET(request:Request){
  const headers={'Cache-Control':'no-store'};
  if(!isAuthorized(request))return Response.json({serverConfigured:false},{status:401,headers});
  const config=getAISettings();
  return Response.json({serverConfigured:!!config.AI_API_KEY,provider:config.AI_PROVIDER||'openrouter',model:config.AI_MODEL||'deepseek/deepseek-v4.1-flash-1017'},{headers});
}
