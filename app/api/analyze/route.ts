import { sanitizeListing, parseLocally } from '../../../lib/listing.ts';
import {getAISettings,isAuthorized} from '../../../lib/ai-context.ts';
import {systemPrompt} from '../../../lib/ai-prompt.ts';
import {classificationPrompt,sanitizeCandidates,categoryById} from '../../../lib/taxonomy.ts';
const windows=new Map<string,{count:number;reset:number}>();

export async function POST(request:Request){
  const headers={'Cache-Control':'no-store'};
  const fail=(error:string,status=400)=>Response.json({error},{status,headers});
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) return fail('Запрос разрешён только со страницы Автопост.',403);
  if(!request.headers.get('content-type')?.includes('application/json')) return fail('Нужен JSON.',415);
  if(Number(request.headers.get('content-length')||0)>22000) return fail('Слишком большой запрос.',413);
  let raw=''; try {const reader=request.body?.getReader();if(!reader)return fail('Пустой запрос.');const decoder=new TextDecoder();let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>22000){await reader.cancel();return fail('Слишком большой запрос.',413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();} catch {return fail('Не удалось прочитать запрос.');}
  if(raw.length>22000)return fail('Слишком большой запрос.',413);
  let body;try{body=JSON.parse(raw);}catch{return fail('Некорректный JSON.');}
  if(!body||typeof body!=='object'||Array.isArray(body))return fail('Нужен объект объявления.');
  if(body.category!==undefined&&!['cars','parts','general'].includes(body.category))return fail('Неизвестная товарная группа.');
  const classify=body.task==='classify';
  const category=body.category==='parts'?'parts':body.category==='general'?'general':'cars';
  if(body.taxonomyId&&!categoryById(body.taxonomyId))return fail('Категория отсутствует в справочнике.');
  if(typeof body.text!=='string'||body.text.trim().length<3||body.text.length>8000)return fail('Введите описание от 3 до 8000 символов.');
  const config=getAISettings();const useServer=!body.key&&!!config.AI_API_KEY;
  if(useServer&&!isAuthorized(request))return fail('Для серверного ИИ войдите в аккаунт владельца сайта.',401);
  const apiKey=useServer?config.AI_API_KEY:body.key;
  if(typeof apiKey!=='string'||apiKey.length<10||apiKey.length>512)return fail('Добавьте API-ключ в настройках ИИ.',401);
  if(useServer){const identity=request.headers.get('oai-authenticated-user-id')||'local';const now=Date.now();for(const [id,bucket]of windows)if(bucket.reset<=now)windows.delete(id);const bucket=windows.get(identity)||{count:0,reset:now+60000};if(bucket.count>=10)return fail('Не более 10 запросов ИИ в минуту. Подождите немного.',429);bucket.count++;windows.set(identity,bucket);}
  const provider=useServer?(config.AI_PROVIDER||'openrouter'):body.provider;
  const providers:Record<string,{url:string;model:string}>={deepseek:{url:'https://api.deepseek.com/chat/completions',model:'deepseek-flash'},openrouter:{url:'https://openrouter.ai/api/v1/chat/completions',model:'deepseek/deepseek-v4.1-flash-1017'}};
  const p=providers[provider];if(!p)return fail('Выберите поддерживаемый сервис ИИ.');
  const requestedModel=useServer?config.AI_MODEL:body.model;
  const model=typeof requestedModel==='string'&&/^[a-zA-Z0-9_./:-]{1,120}$/.test(requestedModel)?requestedModel:p.model;
  try{
    const upstream=await fetch(p.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model,messages:[{role:'system',content:classify?classificationPrompt():systemPrompt(category)},{role:'user',content:body.text}],response_format:{type:'json_object'},max_tokens:2600,...(provider==='deepseek'?{thinking:{type:'disabled'}}:{reasoning:{enabled:false}})}),signal:AbortSignal.timeout(45000)});
    if(!upstream.ok)return fail(upstream.status===401?'API-ключ не принят сервисом.':upstream.status===402?'Недостаточно средств на балансе ИИ.':upstream.status===429?'Сервис ИИ ограничил запросы. Повторите позже.':`Сервис ИИ вернул ошибку ${upstream.status}. Проверьте название модели.`,502);
    const output=await upstream.json() as {choices?:{message?:{content?:string};finish_reason?:string}[]};
    const choice=output.choices?.[0];if(!choice?.message?.content||choice.finish_reason==='length')return fail('ИИ не вернул полную карточку. Повторите запрос.',502);
    const parsed=JSON.parse(choice.message.content);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return fail('ИИ вернул некорректную карточку.',502);
    if(classify)return Response.json({candidates:sanitizeCandidates(parsed.candidates),question:typeof parsed.question==='string'?parsed.question.slice(0,200):'',mode:'ai',model},{headers});
    const listing=sanitizeListing(parsed,category);
    listing.taxonomyId=categoryById(body.taxonomyId)?.id||'';
    const explicit=parseLocally(body.text,category);
    // Critical structured facts must be grounded in the seller's text, not model guesses.
    const phones=body.text.match(/(?:\+?375)[\s()\d-]{9,18}/g)||[];
    const digits=(v:string)=>v.replace(/\D/g,'');
    if(listing.phone&&!phones.some((p:string)=>digits(p)===digits(listing.phone)))listing.phone='';
    if(!listing.phone&&explicit.phone)listing.phone=explicit.phone;
    if(listing.vin&&!body.text.toUpperCase().includes(listing.vin.toUpperCase()))listing.vin='';
    const money=body.text.match(/\d[\d\s]*(?:[.,]\d+)?\s*(?:USD|BYN|EUR|\$|€|бел(?:орусских)?\.?\s*руб|доллар)/gi)||[];
    if(money.length===1&&explicit.price&&explicit.currency){listing.price=explicit.price;listing.currency=explicit.currency;}
    if(category==='parts'){
      listing.quantity=explicit.quantity;
      listing.availability=explicit.availability;
      listing.priceUnit=explicit.priceUnit;
      if(listing.manufacturer&&!body.text.toLowerCase().includes(listing.manufacturer.toLowerCase()))listing.manufacturer='';
    }
    if(category==='parts'&&listing.partNumber){
      const index=body.text.toLowerCase().indexOf(listing.partNumber.toLowerCase());
      listing.partNumber=index<0?'':body.text.slice(index,index+listing.partNumber.length);
    }
    if(!listing.description) listing.description=body.text;
    return Response.json({listing,mode:'ai',model},{headers});
  }catch(error){return fail(error instanceof Error && /timeout|abort/i.test(error.name)?'ИИ не ответил за 45 секунд. Попробуйте ещё раз.':'Не удалось получить корректный ответ ИИ. Можно заполнить карточку вручную.',502);}
}
