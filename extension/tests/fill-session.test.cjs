const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

test('navigation metadata distinguishes browser refresh, history and ordinary navigation', () => {
  for (const type of ['reload','back_forward','navigate']) {
    const context = vm.createContext({URL, performance:{getEntriesByType:()=>[{type}]},document:{referrer:'https://realt.by/'}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../core.js'),'utf8'),context);
    assert.equal(context.AutopostCore.fillNavigation().type,type);
    assert.equal(context.AutopostCore.fillNavigation().referrer,'https://realt.by/');
  }
});

test('a launch is consumed once; reload and cached history cannot regain permission', () => {
  const job = {}, sender = {documentId:'first'}, origins=['https://realt.by'];
  core.armFill(job);
  assert.equal(core.claimFill(job,sender,undefined,origins),false);
  assert.equal(core.claimFill(job,sender,{type:'navigate',referrer:''},origins),true);
  assert.equal(core.claimFill(job,sender,undefined,origins),true,'polling the active document is allowed');
  const next={documentId:'next'};
  assert.equal(core.claimFill(job,next,{type:'navigate',referrer:'https://realt.by/podat-obyavlenie/'},origins),true);
  assert.equal(core.claimFill(job,sender,undefined,origins),false,'late poll from previous document is denied');
  assert.equal(core.canFill(job,next),true,'late poll does not stop the current document');
  assert.equal(core.claimFill(job,next,{type:'back_forward',referrer:'https://realt.by/'},origins),false,'BFCache restoration is blocked even with the same document ID');
  assert.equal(core.claimFill(job,next,{type:'navigate',referrer:'https://realt.by/'},origins),false);
  core.armFill(job);
  assert.equal(core.claimFill(job,{documentId:'reload'},{type:'reload',referrer:'https://87.199.205.227/'},origins),false,'refresh cannot use a pending app launch');
});

test('rental page controller send the navigation type before touching the form on refresh', async () => {
  const {Window} = await import('happy-dom');
  for (const script of ['rental-page.js']) {
    const window = new Window({url:'https://www.kufar.by/ain/create',settings:{enableJavaScriptEvaluation:true}});
    try {
      window.document.body.innerHTML='<input id="price" value="1250">';
      window.performance.getEntriesByType=()=>[{type:'reload'}];
      window.eval(fs.readFileSync(path.join(__dirname,'../core.js'),'utf8'));
      const job={}; core.armFill(job);
      const messages=[];
      window.chrome={runtime:{async sendMessage(message) {
        messages.push(message);
        const navigation=message.navigation || message.payload?.navigation;
        assert.equal(navigation.type,'reload');
        assert.equal(core.claimFill(job,{documentId:'reload'},navigation,['https://www.kufar.by']),false);
        return {task:null};
      }}};
      await window.eval(fs.readFileSync(path.join(__dirname,'..',script),'utf8'));
      assert.equal(messages.length,1);
      assert.equal(window.document.querySelector('#price').value,'1250');
      assert.equal(window.document.querySelector('aside,#autopost-helper-panel'),null);
    } finally {window.close();}
  }
});
