const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function page(t, url, hidden = true) {
  const {Window} = await import('happy-dom');
  const w = new Window({url}); t.after(() => w.close());
  Object.defineProperty(w.document, 'hidden', {get: () => hidden, configurable:true});
  let timer, shadow, live = true;
  const attach = w.HTMLElement.prototype.attachShadow;
  w.HTMLElement.prototype.attachShadow = function(options) {
    const result = attach.call(this, options);
    if (this.id === 'autopost-rental-helper') shadow = result;
    return result;
  };
  w.setInterval = fn => {timer=fn; return 1;}; w.clearInterval = () => {};
  w.AutopostCore = {fillNavigation:()=>({type:'navigate'})};
  const task={jobId:'job',photos:[],recipe:{ready:[{selector:'#form-ready'}],controls:[{field:'price',selector:'#price',action:'text',value:'1300'}]}};
  const messages=[];
  w.chrome={runtime:{id:'extension',onMessage:{addListener(){}},async sendMessage(message){
    messages.push(message);
    return message.type==='GET' ? {task:live?task:null} : {ok:true};
  }}};
  for(const name of ['rental-autocomplete.js','rental-form.js','rental-page.js'])
    await w.eval(fs.readFileSync(path.join(__dirname,'..',name),'utf8'));
  await flush();
  return {w,messages,get shadow(){return shadow;},stop(){live=false;},
    async ticks(n){for(let i=0;i<n;i++){timer();await flush();}},
    async visibility(value){hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));await flush();},
    form(){w.document.body.innerHTML='<div id="form-ready"><input id="price"></div>';},
    price(){return w.document.querySelector('#price').value;},
  };
}
for(const url of ['https://www.kufar.by/ain/create','https://realt.by/podat-obyavlenie/']) {
  test('delayed activation fills '+url+' without consuming background attempts',async t=>{
    const p=await page(t,url);p.form();await p.ticks(150);
    assert.equal(p.price(),'');assert.equal(p.messages.filter(m=>m.type==='GET').length,1);
    await p.visibility(false);await p.ticks(2);assert.equal(p.price(),'1300');
  });
}
test('visible page waits for a late form without exhausting idle attempts',async t=>{
  const p=await page(t,'https://realt.by/podat-obyavlenie/',false);
  await p.ticks(150);p.form();await p.ticks(2);assert.equal(p.price(),'1300');
});
test('activation resumes idle waiting for missing fields but preserves manual pause',async t=>{
  const p=await page(t,'https://realt.by/podat-obyavlenie/',false);
  p.w.document.body.innerHTML='<div id="form-ready"></div>';
  await p.ticks(12);p.form();await p.ticks(2);assert.equal(p.price(),'');
  await p.visibility(true);await p.visibility(false);await p.ticks(2);assert.equal(p.price(),'1300');
  const q=await page(t,'https://www.kufar.by/ain/create',false);
  q.shadow.querySelectorAll('button')[1].click();q.form();
  await q.visibility(true);await q.visibility(false);await q.ticks(12);assert.equal(q.price(),'');
});
test('activation cannot revive a stopped task or a departed document',async t=>{
  for(const reason of ['stopped','departed']) {
    const p=await page(t,'https://realt.by/podat-obyavlenie/');p.form();
    if(reason==='stopped') p.stop();else p.w.dispatchEvent(new p.w.Event('pagehide'));
    await p.visibility(false);await p.ticks(12);assert.equal(p.price(),'');
  }
});
