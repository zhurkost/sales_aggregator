import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';

function page(html,url='https://www.kufar.by/item/123456') {
  const window=new Window({url,settings:{enableJavaScriptEvaluation:true}});
  window.document.body.innerHTML=html;
  for (const name of ['core','publication','status'])window.eval(readFileSync(new URL(`../extension/${name}.js`,import.meta.url),'utf8'));
  return {window,document:window.document,p:window.AutopostPublication,s:window.AutopostStatus,visible:e=>!e.hidden};
}
const pending=()=>({id:'attempt-one',at:Date.now(),title:'Видеокарта RX 570',existing:[]});
test('automatic link recognition accepts detail IDs only, removes tracking, and rejects form/account/external URLs',()=>{
  const {window,p}=page('');try{
    assert.equal(p.listingUrl('kufar','https://kufar.by/item/123456/?utm_source=x#abc'),'https://www.kufar.by/item/123456');
    assert.equal(p.listingUrl('onliner','https://baraholka.onliner.by/viewtopic.php?t=12345&start=1#p'),'https://baraholka.onliner.by/viewtopic.php?t=12345');
    assert.equal(p.listingUrl('bamper','https://bamper.by/zapchast_bamper-peredniy/28187-213335310/'),'https://bamper.by/zapchast_bamper-peredniy/28187-213335310');
    for(const url of ['https://www.kufar.by/ain/create','https://www.kufar.by/account/myads','https://www.kufar.by/l','https://www.kufar.by.evil.invalid/item/123456','https://user:pass@www.kufar.by/item/123456','http://www.kufar.by/item/123456'])assert.equal(p.listingUrl('kufar',url),null);
    assert.equal(p.listingUrl('onliner','https://baraholka.onliner.by/viewtopic.php?t=12345&t=23456'),null);
  }finally{window.close();}
});
test('automatic capture requires a recent submit and matching primary heading, ignores recommendations and old links',()=>{
  const {window,document,p,visible}=page('<h1>Видеокарта RX 570 4 GB</h1><aside><a href="/item/987654">Видеокарта RX 570</a></aside>');try{
    const submission=pending();
    assert.equal(p.observe(document,'kufar',window.location.href,null,visible),null);
    const found=p.observe(document,'kufar',window.location.href,submission,visible);assert.equal(found.url,'https://www.kufar.by/item/123456');
    assert.equal(p.validateCapture('kufar',submission,{...found,attemptId:submission.id},window.location.href),found.url);
    assert.equal(p.validateCapture('kufar',submission,{...found,attemptId:'other'},window.location.href),null);
    assert.equal(p.observe(document,'kufar',window.location.href,{...submission,existing:[found.url]},visible),null);
    assert.equal(p.observe(document,'kufar',window.location.href,{...submission,at:Date.now()-p.MAX_WAIT_MS-1},visible),null);
    document.querySelector('h1').textContent='Видеокарта RX 5700';assert.equal(p.observe(document,'kufar',window.location.href,submission,visible),null);
  }finally{window.close();}
});
test('a receipt must contain one new explicit result link; no recommendation guessing or validation-error success',()=>{
  const {window,document,p,visible}=page('<section>Ваше объявление успешно добавлено. <a href="/item/123456">Посмотреть объявление</a></section>','https://www.kufar.by/ain/create');try{
    assert.equal(p.observe(document,'kufar',window.location.href,pending(),visible).mode,'receipt');
    document.querySelector('section').append(document.createElement('a'));const a=document.querySelector('a:last-child');a.href='/item/987654';a.textContent='Посмотреть объявление';
    assert.equal(p.observe(document,'kufar',window.location.href,pending(),visible),null);
    document.body.innerHTML='<h1>Проверьте ошибки в форме</h1><a href="/item/123456">Посмотреть объявление</a>';
    assert.equal(p.observe(document,'kufar',window.location.href,pending(),visible),null);
  }finally{window.close();}
});
test('only trusted final controls in the observed form arm submission tracking',()=>{
  const {window,document,p}=page('<form id="posting"><a id="btnFleaMarketPostingSubmitEnabled"><span>Добавить объявление</span></a><button>Предпросмотр</button></form>','https://baraholka.onliner.by/fleamarketposting.php');try{
    const event={type:'click',isTrusted:true,target:document.querySelector('span')};
    assert.equal(p.isSubmitEvent(event,'onliner',window.location.href),true);
    assert.equal(p.isSubmitEvent({...event,isTrusted:false},'onliner',window.location.href),false);
    assert.equal(p.isSubmitEvent({...event,target:document.querySelector('button')},'onliner',window.location.href),false);
    assert.equal(p.isSubmitEvent(event,'onliner','https://baraholka.onliner.by/viewtopic.php?t=12345'),false);
  }finally{window.close();}
});
test('Bamper public part pages use an h2 title rather than h1',()=>{
  const {window,document,p,s,visible}=page('<h2>Бампер передний к Mercedes E W211, 2009</h2>','https://bamper.by/zapchast_bamper-peredniy/28187-213335310/');try{
    const submission={...pending(),title:'Бампер передний Mercedes E W211 2009'};
    assert.ok(p.observe(document,'bamper',window.location.href,submission,visible));
    assert.equal(s.inspect(document,window.location.href,{canonicalId:'bamper',url:p.listingUrl('bamper',window.location.href),title:submission.title},visible).state,'visible');
  }finally{window.close();}
});
test('status parser distinguishes moderation, rejection, login and unknown pages, without reading seller description as status',()=>{
  const {window,document,s,visible}=page('');const task={canonicalId:'kufar',url:window.location.href,title:'Видеокарта RX 570'};try{
    for(const [html,state] of [
      ['<h1>Видеокарта RX 570</h1><div role="status">Объявление на модерации</div>','moderation'],
      ['<h1>Объявление отклонено. Исправьте описание.</h1>','rejected'],
      ['<h1>Объявление неактивно</h1>','inactive'],
      ['<h1>Объявление не найдено</h1>','unknown'],
      ['<h1>Вход</h1><input type="password">','action_required'],
      ['<h1>Видеокарта RX 570</h1><p>Объявление отклонено — текст продавца</p>','visible'],
    ]){document.body.innerHTML=html;assert.equal(s.inspect(document,window.location.href,task,visible).state,state);}
    document.body.innerHTML='<h1>Главная страница</h1>';assert.equal(s.inspect(document,window.location.href,task,visible),null);
  }finally{window.close();}
});
test('marketplace controller captures after navigation before routing and only stops after worker acknowledgement',async()=>{
  const {window,document}=page('<h1>Видеокарта RX 570</h1>');const reports=[];let succeed=false,shadow;
  const attach=window.HTMLElement.prototype.attachShadow;
  window.HTMLElement.prototype.attachShadow=function(options){shadow=attach.call(this,options);return shadow;};
  const task={jobId:'job',name:'Kufar',listing:{title:'Видеокарта RX 570'},photos:[],expiresAt:Date.now()+60000,submission:pending()};
  window.AutopostDOM={visible:()=>true,findNative(){throw new Error('Result page must not route or fill');}};
  window.chrome={runtime:{id:'extension',onMessage:{addListener(){}},async sendMessage(message){
    if(message.kind==='GET_TASK')return {task};
    reports.push(message);return succeed?{ok:true}:{error:'Retry transmission'};
  }}};
  try{
    await window.eval(readFileSync(new URL('../extension/marketplace.js',import.meta.url),'utf8'));
    assert.equal(reports[0].report.status,'link_recorded');assert.equal(reports[0].report.userConfirmed,undefined);
    assert.match(shadow.textContent,/Retry transmission/);
    const current=[...shadow.querySelectorAll('button')].find(b=>b.textContent==='Сохранить ссылку этой страницы');assert.equal(current.disabled,false);
    succeed=true;current.click();await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(current.disabled,true);assert.equal(reports.at(-1).report.userConfirmed,true);assert.match(shadow.textContent,/Ссылка передана/);
  }finally{await window.happyDOM.abort();window.close();}
});
