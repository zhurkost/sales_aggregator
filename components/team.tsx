"use client";
import {useEffect,useState} from 'react';
import {api,extension} from '../lib/workspace';
type Team={role:string;workspaceId:string;workspaces:{id:string;name:string}[];members:{id:string;name:string;login:string;role:string}[]};
export function TeamView({profileId,connected,notify}:{profileId:string;connected:boolean;notify:(s:string)=>void}) {
  const [team,setTeam]=useState<Team|null>(null),[login,setLogin]=useState(''),[busy,setBusy]=useState(false);
  async function load(){setTeam(await api<Team>('workspace/team'));}
  useEffect(()=>{void load().catch(e=>notify((e as Error).message));},[]);
  async function action(body:unknown){setBusy(true);try{setTeam(await api<Team>('workspace/team',body));setLogin('');}catch(e){notify((e as Error).message);}finally{setBusy(false);}}
  return <><h1>Команда и кабинеты</h1><p className="subtitle">Личный кабинет остаётся отдельным. В общем кабинете менеджеры работают с одними карточками.</p>
    <section className="panel"><h2>Доступные кабинеты</h2>{team?.workspaces.map(w=><div className="bulk-row" key={w.id}><b>{w.name}</b>{w.id===team.workspaceId?<span>Текущий кабинет</span>:<button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{if(connected)await extension('PAUSE',{profileId});await api('workspace/team',{action:'switch',workspaceId:w.id});location.reload();}catch(e){notify((e as Error).message);setBusy(false);}}}>Перейти</button>}</div>)}</section>
    <section className="panel"><h2>Участники кабинета</h2>{team?.members.map(m=><div className="bulk-row" key={m.id}><span>{m.name} · {m.login} · {m.role==='owner'?'Владелец':'Менеджер'}</span>{team.role==='owner'&&m.role!=='owner'&&<button className="text-button" disabled={busy} onClick={()=>action({action:'remove',memberId:m.id})}>Закрыть доступ</button>}</div>)}
    {team?.role==='owner'&&<><label className="full-label">Логин зарегистрированного участника<input value={login} maxLength={40} onChange={e=>setLogin(e.target.value)}/></label><p className="hint">Менеджер получит доступ ко всем карточкам, фото и контактам этого кабинета и сможет их менять. Его личный кабинет останется закрытым.</p><button className="primary" disabled={busy||!login.trim()} onClick={()=>action({action:'add',login})}>Предоставить доступ менеджеру</button></>}
    </section><p className="fine-print">Входы на торговые площадки остаются в браузере каждого участника. Доступ к кабинету не передаёт авторизацию площадок. После отзыва доступа уже открытые внешние формы нужно закрыть отдельно.</p>
  </>;
}
export function Assignee({value,onChange,notify}:{value:string;onChange:(id:string)=>void;notify:(s:string)=>void}) {
  const [members,setMembers]=useState<Team['members']>([]);
  useEffect(()=>{void api<Team>('workspace/team').then(t=>setMembers(t.members)).catch(e=>notify((e as Error).message));},[]);
  return <label className="full-label">Ответственный<select value={value} onChange={e=>onChange(e.target.value)}><option value="">Не назначен</option>{members.map(m=><option key={m.id} value={m.id}>{m.name} · {m.login}</option>)}</select></label>;
}
