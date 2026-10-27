import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export function publicIPv4(ip) {
  if(isIP(ip)!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,2,168].includes(b)||a===198&&[18,19,51].includes(b)||a===203&&b===0||a===100&&b>=64&&b<=127);
}
export async function fetchFeed(address,redirects=0,resolve=lookup) {
  let url;try{url=new URL(address);}catch{throw new Error('Укажите HTTPS-ссылку на YML.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hostname.endsWith('.')||isIP(url.hostname)||url.hostname.length>253||redirects>3)
    throw new Error('Нужен публичный HTTPS-адрес каталога без пароля и нестандартного порта.');
  const addresses=await resolve(url.hostname,{all:true,family:4});
  if(!addresses.length || addresses.some(a=>!publicIPv4(a.address)))throw new Error('Внутренние сетевые адреса недоступны для импорта.');
  const pinned=addresses[0].address;
  const response=await new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{Accept:'application/xml,text/xml,text/plain','Accept-Encoding':'identity'},
      lookup:(_host,opts,cb)=>opts?.all?cb(null,[{address:pinned,family:4}]):cb(null,pinned,4)},res=>resolve(res));
    req.setTimeout(12000,()=>req.destroy(new Error('Источник каталога не ответил вовремя.')));req.on('error',reject);
  });
  if([301,302,303,307,308].includes(response.statusCode)) {
    response.destroy();return fetchFeed(new URL(response.headers.location,url).href,redirects+1,resolve);
  }
  if(response.statusCode!==200 || response.headers['content-encoding']&&response.headers['content-encoding']!=='identity') {response.destroy();throw new Error('Источник не вернул доступный XML-каталог.');}
  const chunks=[];let size=0;
  const timer=setTimeout(()=>response.destroy(new Error('Превышено время загрузки каталога.')),15000);
  try{for await(const chunk of response){size+=chunk.length;if(size>5*1024*1024){response.destroy();throw new Error('Каталог больше 5 МБ.');}chunks.push(chunk);}}
  finally{clearTimeout(timer);}
  const bytes=Buffer.concat(chunks);
  const label=/encoding\s*=\s*["']windows-1251["']/i.test(bytes.subarray(0,200).toString('ascii'))?'windows-1251':'utf-8';
  const text=new TextDecoder(label,{fatal:true}).decode(bytes);
  if(!/<yml_catalog[\s>]/.test(text)||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('По ссылке должен быть YML без DTD и сущностей.');
  return text;
}
