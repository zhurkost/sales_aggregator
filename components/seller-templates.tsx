"use client";
import {useEffect,useState} from 'react';
import {api,type AdRecord} from '../lib/workspace';
import {emptyTemplate,templateText,type SellerTemplate} from '../lib/seller-template';
export function SellerTemplates({record,onApply,notify}:{record?:AdRecord;onApply?:(r:AdRecord)=>void;notify:(s:string)=>void}) {
  const [templates,setTemplates]=useState<SellerTemplate[]>([]),[draft,setDraft]=useState(emptyTemplate),[busy,setBusy]=useState(false);
  useEffect(()=>{void api<{settings:{templates?:SellerTemplate[]}}>('workspace/settings').then(r=>setTemplates(r.settings.templates||[])).catch(e=>notify((e as Error).message));},[]);
  async function save(next:SellerTemplate[]){setBusy(true);try{await api('workspace/settings',{templates:next});setTemplates(next);setDraft(emptyTemplate);notify('Шаблоны сохранены.');}catch(e){notify((e as Error).message);}finally{setBusy(false);}}
  if(record)return <section className="panel"><h2>Шаблоны продавца</h2><select aria-label="Применить шаблон" value="" onChange={e=>{const t=templates.find(t=>t.id===e.target.value);if(t)onApply?.({...record,listing:{...record.listing,description:[record.listing.description,templateText(t)].filter(Boolean).join('\n\n').slice(0,8000)},platformText:t.platformText});}}><option value="">Добавить условия из шаблона…</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><p className="hint">Настройте доставку, гарантию и склад в «Моём профиле». Текст добавляется к описанию; проверьте его перед отправкой.</p></section>;
  return <section className="panel"><h2>Шаблоны продавца</h2>{templates.map(t=><div className="bulk-row" key={t.id}><b>{t.name}</b><button className="text-button" onClick={()=>setDraft(t)}>Изменить</button><button className="text-button" disabled={busy} onClick={()=>save(templates.filter(x=>x.id!==t.id))}>Удалить шаблон</button></div>)}
    <div className="fields-grid">{(['name','delivery','warranty','warehouse'] as const).map(key=><label key={key}>{{name:'Название шаблона',delivery:'Доставка',warranty:'Гарантия',warehouse:'Склад / самовывоз'}[key]}<input value={draft[key]} maxLength={key==='name'?80:500} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div>
    <details><summary>Дополнительный текст для отдельных площадок</summary>{['kufar','onliner','bamper','av','abw','flagma','drom'].map(id=><label className="full-label" key={id}>{id}<textarea value={draft.platformText[id]||''} maxLength={1000} onChange={e=>setDraft({...draft,platformText:{...draft.platformText,[id]:e.target.value}})}/></label>)}</details>
    <button className="secondary" disabled={busy||!draft.name.trim()} onClick={()=>save([...templates.filter(t=>t.id!==draft.id),{...draft,id:draft.id||crypto.randomUUID()}])}>Сохранить шаблон</button>
  </section>;
}
