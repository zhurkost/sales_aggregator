"use client";
import {useEffect,useRef,useState} from "react";
import type {Listing} from "../lib/listing";
import type {ProductIdentity} from "../lib/price-identification";
import {api,extension} from "../lib/workspace";

type Offer = {title:string;url:string;price:number|null;currency:string;condition:string};
type PriceGroup = {currency:string;count:number;min:number;max:number;median:number};
type Result = {id:string;name:string;url:string;status:string;error?:string;total?:number|null;scanned?:number;matched?:number;unpriced?:number;unknownCondition?:number;groups?:PriceGroup[];offers?:Offer[]};
type Snapshot = {checkedAt:string;query:string;cached?:boolean;results:Result[]};
const money = (value:number,currency:string) => `${value.toLocaleString("ru-RU",{maximumFractionDigits:2})} ${currency}`;
function safeSearchLink(value:string) {
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['www.kufar.by','baraholka.onliner.by'].includes(url.hostname)?url.href:undefined;}catch{return undefined;}
}
export function PriceComparison({listing,recordId,ext,serverAI,onExtension,details=""}:{listing:Listing;recordId:string;ext:boolean;serverAI:boolean;onExtension:()=>void;details?:string}) {
  const [identity,setIdentity]=useState<ProductIdentity|null>(null);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const source = JSON.stringify(Object.fromEntries(['title','description','brand','model','year','partName','partNumber','manufacturer','condition','compatibility','fitYears','priceUnit'].map(key=>[key,listing[key as keyof Listing]]))) + details;
  const fingerprint = recordId+listing.taxonomyId+source;
  const current=useRef(fingerprint);current.current=fingerprint;
  useEffect(()=>{current.current=fingerprint;setIdentity(null);setSnapshot(null);setError("");setBusy("");return()=>{current.current="";};},[fingerprint]);
  async function identify() {
    const request=fingerprint;
    setBusy("Определяем товар…");setError("");setSnapshot(null);setIdentity(null);
    try {
      if(!serverAI)throw new Error("Для проверки товара подключите ИИ в настройках сервера.");
      const text=source.replace(/\+?375[\s()\d-]{9,18}/g,'[телефон удалён]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email удалён]').slice(0,8000);
      const result=await api<{identity:ProductIdentity}>("analyze",{task:"identify",text,category:listing.category,taxonomyId:listing.taxonomyId});
      if(current.current===request)setIdentity(result.identity);
    } catch(e) {if(current.current===request)setError(e instanceof Error?e.message:"Не удалось проверить товар.");}
    finally {if(current.current===request)setBusy("");}
  }
  async function search() {
    const request=fingerprint;
    if(!identity || identity.status!=="identified")return;
    if(!ext){onExtension();return;}
    setBusy("Ищем на площадках…");setError("");
    try {
      const result=await extension("PRICE_SEARCH",{...identity,taxonomyId:listing.taxonomyId},25000);
      if(!Array.isArray(result.results))throw new Error("Обновите расширение: поиск цен требует новую версию.");
      if(current.current===request)setSnapshot(result as Snapshot);
    } catch(e){if(current.current===request)setError(e instanceof Error?e.message:"Не удалось получить цены.");}
    finally{if(current.current===request)setBusy("");}
  }
  return <section className="panel price-comparison" aria-label="Сравнение цен">
    <div className="section-title"><div><h2>Сравнить цены</h2></div></div>
    <p>Сначала проверим, какой товар или услугу искать. Затем расширение получит первую страницу подходящих предложений Kufar и Барахолки Onlíner без открытия вкладок.</p>
    <button className="secondary" disabled={!!busy} onClick={()=>void identify()}>{busy || (identity?"Проверить товар заново":"Определить товар для поиска")}</button>
    {identity && <div className="price-identity" role="status">
      <strong>{identity.name || "Нужно уточнение"}</strong>
      {identity.status==="identified"?<><p>Поисковый запрос: <b>{identity.query}</b>{identity.condition?` · ${identity.condition}`:""}</p><button className="primary" disabled={!!busy} onClick={()=>void search()}>Найти цены на площадках</button></>:<p>{identity.question} Исправьте описание карточки и повторите проверку.</p>}
    </div>}
    {error && <p role="alert" className="validation">{error}</p>}
    {snapshot && <div className="price-results">
      <p className="fine-print">Проверено {new Date(snapshot.checkedAt).toLocaleString("ru-RU")}{snapshot.cached?" · результат последнего запроса (до 5 минут)":""}. Поиск по Беларуси.</p>
      {snapshot.results.map(result=><article className="price-source" key={result.id}>
        <h3>{result.name} <a href={safeSearchLink(result.url)} target="_blank" rel="noreferrer">Открыть поиск ↗</a></h3>
        {result.status!=="ok"?<p>{result.error}</p>:<>
          <p>{result.total!=null?`Найдено площадкой: ${result.total}. `:"Общее количество площадка не передала. "}На загруженной странице: {result.scanned}; похожих по названию: {result.matched}.</p>
          {!!result.groups?.length?<div className="price-table"><table><thead><tr><th>Валюта</th><th>С ценой</th><th>От — до</th><th>Медиана</th></tr></thead><tbody>{result.groups.map(group=><tr key={group.currency}><td>{group.currency}</td><td>{group.count}</td><td>{money(group.min,group.currency)} — {money(group.max,group.currency)}</td><td><b>{money(group.median,group.currency)}</b></td></tr>)}</tbody></table></div>:<p>Недостаточно сопоставимых предложений с указанной ценой.</p>}
          {!!result.unpriced&&<p className="fine-print">Без числовой цены: {result.unpriced}; в расчёт не входят.</p>}
          {!!result.unknownCondition&&<p className="fine-print">У {result.unknownCondition} предложений состояние не указано в выдаче — проверьте его по ссылкам.</p>}
          {!!result.offers?.length&&<details><summary>Посмотреть предложения ({result.offers.length})</summary><ul>{result.offers.map(offer=><li key={offer.url}><a href={safeSearchLink(offer.url)} target="_blank" rel="noreferrer">{offer.title}</a> — {offer.price==null?"Цена не указана":money(offer.price,offer.currency)}{offer.condition?` · ${offer.condition}`:""}</li>)}</ul></details>}
        </>}
      </article>)}
      <p className="fine-print">Это цены предложений, а не завершённых сделок. Выборка ограничена одной страницей; состояние, комплектация и актуальность могут отличаться. Медиана — середина найденных цен, не оценка стоимости вашего товара. Валюты не пересчитываются.</p>
    </div>}
  </section>;
}
