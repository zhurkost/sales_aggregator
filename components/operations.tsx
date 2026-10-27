"use client";
import {useState} from 'react';
import {readiness,queueGroup} from '../lib/readiness';
import {listingTitle} from '../lib/listing';
import {getPlatforms,statusLabel,remoteStatusLabel,type Job} from '../lib/platforms';
import {api,extension,type AdRecord,type AdSummary} from '../lib/workspace';
import {editListing,emptyBatchEdit} from '../lib/batch-edit';

export function Readiness({record,connected,onOpen}:{record:AdRecord;connected:boolean;onOpen:(job:Job)=>void}) {
  const rows=readiness(record,connected);
  return <section className="panel" aria-label="Готовность площадок"><h2>Готовность к размещению</h2>
    {!rows.length&&<p>Выберите площадки для проверки.</p>}
    {rows.map(row=><div className="readiness-row" key={row.platform.id}>
      <b>{row.platform.name}</b><span className="soft-badge">{row.existing?'Задание уже существует':row.blockers.length?'Нужны данные':'Данные подготовлены'}</span>
      {row.existing&&<p>{row.job?.url?<a href={row.job.url} target="_blank" rel="noreferrer">Открыть размещённое объявление ↗</a>:<button className="text-button" onClick={()=>onOpen(row.job!)}>Продолжить существующее задание ↗</button>}. Повторная подача исключена.</p>}
      {!!row.blockers.length&&<p className="validation-errors">{row.blockers.join(' · ')}</p>}
      <details><summary>Требования и границы проверки</summary><ul>{row.notes.map(n=><li key={n}>{n}</li>)}</ul></details>
    </div>)}
  </section>;
}

export function BulkEdit({ads,onSaved,notify}:{ads:AdSummary[];onSaved:()=>Promise<void>;notify:(s:string)=>void}) {
  const [selected,setSelected]=useState<string[]>([]),[edit,setEdit]=useState(emptyBatchEdit),[preview,setPreview]=useState<AdSummary[]>([]),[busy,setBusy]=useState(false);
  const set=(key:keyof typeof edit,value:string)=>{setEdit({...edit,[key]:value});setPreview([]);};
  function prepare(){try{setPreview(ads.filter(a=>selected.includes(a.id)).map(a=>({...a,listing:editListing(a.listing,edit)})));}catch(e){notify((e as Error).message);}}
  async function save(){setBusy(true);try{await api('workspace/batch-edit',{items:preview.map(a=>({id:a.id,revision:a.revision})),edit});setPreview([]);await onSaved();notify('Карточки обновлены. Уже размещённые объявления отмечены как требующие обновления.');}catch(e){notify((e as Error).message);setPreview([]);}finally{setBusy(false);}}
  return <><h1>Массовое редактирование</h1><p className="subtitle">Изменения сначала показываются в предпросмотре. Цены сохраняют валюту каждой карточки.</p>
    <section className="panel"><div className="fields-grid">
      <label>Город<input value={edit.city} onChange={e=>set('city',e.target.value)} placeholder="Без изменений"/></label>
      <label>Телефон<input value={edit.phone} onChange={e=>set('phone',e.target.value)} placeholder="Без изменений"/></label>
      <label>Наличие<select value={edit.availability} onChange={e=>set('availability',e.target.value)}><option value="">Без изменений</option><option>В наличии</option><option>Под заказ</option></select></label>
      <label>Цены<select value={edit.priceMode} onChange={e=>set('priceMode',e.target.value)}><option value="keep">Без изменений</option><option value="percent">Изменить на %</option><option value="fixed">Установить цену</option></select></label>
      {edit.priceMode!=='keep'&&<label>{edit.priceMode==='percent'?'Процент, например −10':'Новая цена'}<input value={edit.priceValue} onChange={e=>set('priceValue',e.target.value)} inputMode="decimal"/></label>}
    </div><p className="hint">Пустые поля не меняют сохранённые значения. До 100 карточек за операцию.</p>
    {ads.filter(a=>!a.archived&&!a.sold).map(a=><label className="confirm bulk-row" key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id));setPreview([]);}}/>{listingTitle(a.listing)} · {a.listing.price} {a.listing.currency}</label>)}
    <button className="secondary" disabled={busy||!selected.length||selected.length>100} onClick={prepare}>Предпросмотр изменений</button></section>
    {!!preview.length&&<section className="panel"><h2>Проверка перед сохранением</h2>{preview.map(a=>{const old=ads.find(o=>o.id===a.id)!;return <div className="readiness-row" key={a.id}><b>{listingTitle(a.listing)}</b>{(['price','city','phone','availability'] as const).filter(k=>a.listing[k]!==old.listing[k]).map(k=><p key={k}>{{price:'Цена',city:'Город',phone:'Телефон',availability:'Наличие'}[k]}: {old.listing[k]||'—'} → {a.listing[k]} {k==='price'?a.listing.currency:''}</p>)}</div>;})}<button className="primary" disabled={busy} onClick={save}>Применить к {preview.length} карточкам</button><p className="fine-print">Сохранение меняет карточки в Автопосте. На площадках изменения потребуют отдельного подтверждения.</p></section>}
  </>;
}

export function History({record,onRestored,notify}:{record:AdRecord;onRestored:()=>Promise<void>;notify:(s:string)=>void}) {
  const [versions,setVersions]=useState<{version:number;created:string;data:{listing:AdRecord['listing']}}[]>([]),[busy,setBusy]=useState(false);
  return <section className="panel"><h2>История карточки · версия {record.contentVersion||1}</h2>
    {record.jobs.filter(j=>j.url&&j.sentVersion&&j.sentVersion<(record.contentVersion||1)).map(j=><p className="validation-errors" key={j.platformId}>На {getPlatforms(record.listing.category,record.listing.taxonomyId).find(p=>p.id===j.platformId)?.name} передана версия {j.sentVersion}. Текущие изменения ещё не переданы.</p>)}
    <details><summary>Журнал изменений ({record.events.length})</summary><ol>{record.events.slice().reverse().map((e,i)=><li key={i}>{new Date(e.at).toLocaleString('ru-RU')} · {e.message} {e.actor&&`· ${e.actor}`}</li>)}</ol></details>
    <button className="text-button" disabled={busy} onClick={async()=>{try{setVersions((await api<{versions:typeof versions}>('workspace/ads/'+record.id+'/versions')).versions);}catch(e){notify((e as Error).message);}}}>Загрузить предыдущие версии</button>
    {versions.map(v=><details key={v.version}><summary>Версия {v.version} · {v.data.listing.title} · {v.data.listing.price} {v.data.listing.currency}</summary><p className="preview-description">{v.data.listing.description}</p><p>{v.data.listing.city} · {v.data.listing.phone}</p><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('workspace/ads/'+record.id+'/versions',{version:v.version,revision:record.revision});await onRestored();setVersions([]);notify('Текст и характеристики восстановлены. Фото и ссылки сохранены.');}catch(e){notify((e as Error).message);}finally{setBusy(false);}}}>Восстановить текст и характеристики версии {v.version}</button></details>)}
    <p className="fine-print">Храним до 20 предыдущих версий текста и характеристик. Восстановление не меняет фотографии и объявления на площадках.</p>
  </section>;
}

export function QueueView({ads,profileId,onOpen,onCard,notify,paused,onPaused}:{ads:AdSummary[];profileId:string;onOpen:(ad:AdSummary,job:Job)=>void;onCard:(id:string)=>void;notify:(s:string)=>void;paused:boolean;onPaused:(value:boolean)=>void}) {
  const [filter,setFilter]=useState('all');
  const [busy,setBusy]=useState(false);
  const rows=ads.filter(a=>!a.archived).flatMap(ad=>ad.jobs.map(job=>({ad,job,group:queueGroup(job)})));
  const groups=[['all','Все задания'],['attention','Нужен ваш шаг'],['running','Выполняются'],['waiting','Ожидают'],['done','Завершены']] as const;
  async function toggle(){setBusy(true);try{await extension(paused?'RESUME':'PAUSE',{profileId});onPaused(!paused);notify(paused?'Очередь продолжена.':'Очередь приостановлена. Уже отправленный запрос нельзя отменить.');}catch(e){notify(e instanceof Error?e.message:'Помощник недоступен.');}finally{setBusy(false);}}
  return <><div className="heading-row"><div><h1>Очередь и уведомления</h1><p className="subtitle">Текущее состояние заданий. Нажмите на площадку, чтобы продолжить.</p></div><button className="secondary" disabled={busy} onClick={toggle}>{paused?'Продолжить очередь':'Приостановить очередь'}</button></div>
    <div className="queue-filters">{groups.map(([id,label])=><button key={id} className={id===filter?'primary':'secondary'} onClick={()=>setFilter(id)}>{label} ({rows.filter(r=>id==='all'||r.group===id).length})</button>)}</div>
    {!rows.length&&<div className="panel">Заданий пока нет. Создайте объявление или загрузите таблицу.</div>}
    {rows.filter(r=>filter==='all'||r.group===filter).sort((a,b)=>Number(b.group==='attention')-Number(a.group==='attention')).map(({ad,job,group})=><article className="panel queue-entry" key={ad.id+job.platformId}>
      <button className="text-button" onClick={()=>onCard(ad.id)}>{listingTitle(ad.listing)||'Без названия'}</button>
      <b>{getPlatforms(ad.listing.category,ad.listing.taxonomyId).find(p=>p.id===job.platformId)?.name} · {job.remoteStatus?remoteStatusLabel[job.remoteStatus.state]:statusLabel[job.status]}</b>
      <p>{job.remoteStatus?.message||job.message}</p>
      <small>{new Date(job.remoteStatus?.checkedAt||ad.updatedAt).toLocaleString('ru-RU')}</small>
      {job.url?<a className="secondary" href={job.url} target="_blank" rel="noreferrer">Открыть объявление ↗</a>:group!=='done'&&<button className="secondary" onClick={()=>onOpen(ad,job)}>Продолжить на площадке ↗</button>}
    </article>)}
    <p className="fine-print">Пауза управляет очередью в этом браузере. Задания, сохранённые ранее, могут потребовать повторного открытия. Автоматический повтор отправки при неизвестном результате отключён.</p>
  </>;
}
