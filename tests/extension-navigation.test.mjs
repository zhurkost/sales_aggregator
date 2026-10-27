import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';

function environment(html, url='https://av.by/new_ad') {
  const window=new Window({url,settings:{enableJavaScriptEvaluation:true}});
  window.document.body.innerHTML=html;
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:this.hidden?0:100,height:30};};
  for(const file of ['core.js','navigation.js','dom.js','av.js'])window.eval(readFileSync(new URL('../extension/'+file,import.meta.url),'utf8'));
  const task={listing:{category:'cars',brand:'Volkswagen',model:'Passat',year:'2018'},mapping:{id:'cars',path:['Легковые автомобили']}};
  return {window,document:window.document,task,dom:window.AutopostDOM,nav:window.AutopostNavigation,
    plan:()=>window.AutopostNavigation.plan(window.document,'av',url,task,window.AutopostDOM,false)};
}
function close(e){e.window.happyDOM.abort();e.window.close();}

test('AV selects the car category instead of the global submit header, using the observed draft route',()=>{
  const e=environment('<header><a href="/new_ad">Подать объявление</a><a href="/cars">Автомобили</a></header><main><a id="cars" href="/offer/draft/cars"><span>Автомобили</span><small>Продажа легкового транспорта</small></a><a href="/offer/draft/moto">Мотоциклы</a></main>');
  try {
    const p=e.plan();assert.equal(p.step,'vehicle-category');assert.equal(p.control.id,'cars');assert.equal(p.to,'https://av.by/offer/draft/cars');
    assert.equal(e.window.AutopostCore.startUrl('av',e.task.listing),p.to);
    e.task.navigationSteps={'vehicle-category':{at:1}};
    assert.equal(e.plan().step,undefined,'A reload must never click the same step again');
  }finally{close(e);}
});

test('AV client-rendered category shell can navigate to the route confirmed by supplied NEXT_DATA',()=>{
  const e=environment('<div id="__next"></div>');
  try {
    assert.equal(e.plan().to,'https://av.by/offer/draft/cars');assert.equal(e.plan().control,null);
    for(const url of ['https://av.by/new_ad','https://av.by/new_ad/?from=menu#top','https://av.by/new-ad','https://av.by/newAd']) assert.equal(e.nav.avCategoryPage(url),true);
    for(const url of ['https://other.invalid/new_ad','https://av.by/new_ad/another','https://av.by/offer/draft/cars']) assert.equal(e.nav.avCategoryPage(url),false);
    e.task.listing.category='parts';assert.equal(e.plan().step,undefined);
  }finally{close(e);}
});

test('navigation rejects self-links including query/hash variations and cross-marketplace links',()=>{
  const e=environment('<a href="/?new=1#top">Подать объявление</a><a href="https://www.kufar.by/ain/create">Продать автомобиль</a>','https://av.by/');
  try {
    assert.equal(e.plan().step,undefined);
    for(const to of ['https://av.by/new_ad/?session=2','https://av.by/new_ad#top','javascript:alert(1)','https://av.by@other.invalid/','https://www.kufar.by/ain/create'])
      assert.equal(e.nav.target('av',to,'https://av.by/new_ad'),'');
    assert.equal(e.nav.canClaim('av','https://av.by/new_ad','entry','https://av.by/offer/draft/cars',e.task.listing),false);
    assert.equal(e.nav.canClaim('av','https://av.by/new_ad','vehicle-category','https://av.by/offer/draft/cars',e.task.listing),true);
  }finally{close(e);}
});

test('AV draft progresses through fields before description exists and preserves manual corrections',async()=>{
  // Synthetic field structure; the supplied source contains an empty React root.
  const e=environment('<header><a href="/new_ad">Подать объявление</a></header><main><label>Марка<select id="p-4-brand" name="brand"><option value="">Выберите</option><option>Volkswagen</option><option>Audi</option></select></label></main>','https://av.by/offer/draft/cars');
  try {
    assert.equal(e.plan().state,'form');assert.equal(e.document.querySelector('textarea'),null);
    let result=await e.dom.fillFields(e.task,'av');assert.ok(result.filled.includes('brand'));assert.ok(result.skipped.includes('model'));
    e.document.querySelector('main').insertAdjacentHTML('beforeend','<label>Модель<select id="p-5-model" name="model"><option value="">Выберите</option><option>Passat</option></select></label>');
    result=await e.dom.fillFields(e.task,'av');assert.ok(result.filled.includes('model'));
    e.document.querySelector('main').insertAdjacentHTML('beforeend','<label>Год выпуска<select name="year"><option value="">Выберите</option><option>2018</option></select></label>');
    result=await e.dom.fillFields(e.task,'av');assert.ok(result.filled.includes('year'));
    e.document.querySelector('[name=brand]').value='Audi';await e.dom.fillFields(e.task,'av');assert.equal(e.document.querySelector('[name=brand]').value,'Audi');
    assert.equal(e.plan().state,'form','No later field may restart the category wizard');
  }finally{close(e);}
});

test('login and later AV steps cannot click the header, other marketplaces retain their entry links',()=>{
  for(const url of ['https://av.by/login','https://av.by/offer/123/edit','https://cars.av.by/unknown']){
    const e=environment('<a href="/new_ad">Подать объявление</a>',url);
    try {assert.equal(e.plan().step,undefined);}finally{close(e);}
  }
  const e=environment('<a href="/new_ad">Подать объявление</a><input type="password">');
  try {assert.equal(e.plan().status,'authorization_required');}finally{close(e);}
  const other=environment('<a href="/new">Подать объявление</a>','https://bamper.by/');
  try {const p=other.nav.plan(other.document,'bamper',other.window.location.href,other.task,other.dom,false);assert.equal(p.step,'entry');assert.equal(p.to,'https://bamper.by/new');}finally{close(other);}
});

test('actual marketplace content script fills AV fields before description and resumes on the next poll',async()=>{
  const e=environment('<header><a href="/new_ad">Подать объявление</a></header><main><label>Марка<select id="p-4-brand" name="brand"><option value="">Выберите</option><option>Volkswagen</option></select></label></main>','https://av.by/offer/draft/cars');
  try {
    const reports=[],requests=[];let poll;
    e.window.setInterval=callback=>{poll=callback;return 1;};
    const task={...e.task,jobId:'test-job',name:'av.by',expiresAt:Date.now()+60000,photos:[],filledKeys:[],publishMode:'manual'};
    e.window.chrome={runtime:{id:'test-id',onMessage:{addListener(){}},sendMessage:async message=>{
      requests.push(message.kind);
      if(message.kind==='GET_TASK')return {task:structuredClone(task)};
      if(message.kind==='REPORT_TASK')reports.push(message.report);
      return {ok:true};
    }}};
    for(const file of ['publication.js','autopublish.js'])e.window.eval(readFileSync(new URL('../extension/'+file,import.meta.url),'utf8'));
    let headerClicks=0;e.document.querySelector('header a').onclick=event=>{event.preventDefault();headerClicks++;};
    await e.window.eval(readFileSync(new URL('../extension/marketplace.js',import.meta.url),'utf8'));
    assert.ok(reports.some(r=>r.filledKeys.includes('brand')),JSON.stringify(reports));
    e.document.querySelector('main').insertAdjacentHTML('beforeend','<label>Модель<select id="p-5-model" name="model"><option value="">Выберите</option><option>Passat</option></select></label>');
    await poll();
    for(let i=0;i<20&&!reports.some(r=>r.filledKeys.includes('model'));i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(reports.some(r=>r.filledKeys.includes('model')),JSON.stringify(reports));
    assert.equal(requests.includes('CLAIM_NAVIGATION'),false);assert.equal(headerClicks,0);
  }finally{close(e);}
});
