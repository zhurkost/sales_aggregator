"use client";
import {useEffect,useRef,useState} from 'react';
import {api,type AdSummary} from '../lib/workspace';
type Notice={id:number;recordId:string;platformId:string;message:string;created:string;seen:number};
export function Notifications({ads,expanded,onCard,notify}:{ads:AdSummary[];expanded:boolean;onCard:(id:string)=>void;notify:(s:string)=>void}) {
  const [notices,setNotices]=useState<Notice[]>([]);
  const last=useRef<number|null>(null);
  useEffect(()=>{let live=true;void api<{notifications:Notice[]}>('workspace/notifications').then(r=>{if(!live)return;setNotices(r.notifications);const newest=r.notifications[0]?.id||0;if(last.current!==null&&newest>last.current&&r.notifications.some(n=>!n.seen&&n.id>last.current!))notify('Есть новое событие, требующее внимания. Откройте «Очередь и уведомления».');last.current=newest;}).catch(()=>{});return()=>{live=false;};},[ads]);
  const unread=notices.filter(n=>!n.seen);
  if(!expanded)return unread.length?<p className="notice-summary" role="status">Требуют внимания: {unread.length}. Подробности — в «Очереди и уведомлениях».</p>:null;
  return <section className="panel"><h2>События, требующие внимания · {unread.length} новых</h2><p className="hint">Отклонения, вход в аккаунт, капча и ошибки. Прочтение уведомления не исправляет проблему.</p>
    <button className="text-button" disabled={!unread.length} onClick={async()=>{try{const r=await api<{notifications:Notice[]}>('workspace/notifications',{ids:unread.map(n=>n.id)});setNotices(r.notifications);}catch(e){notify((e as Error).message);}}}>Отметить новые как прочитанные</button>
    {notices.slice(0,30).map(n=><div className="readiness-row" key={n.id}><button className="text-button" onClick={()=>onCard(n.recordId)}>{!n.seen?'● ':''}{n.message}</button><small>{new Date(n.created).toLocaleString('ru-RU')}</small></div>)}
  </section>;
}
