const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function setup(t) {
  const {Window} = await import('happy-dom');
  const w = new Window({url:'https://r.onliner.by/ak/apartments/create'});
  t.after(()=>w.close());
  w.document.body.innerHTML='<input class="new-photos__input-file" name="file" type="file">';
  const photos = {items:[],uploadQueue:[]};
  w.ko = {unwrap:x=>typeof x==='function'?x():x, contextFor:()=>({$root:{data:{photos}}})};
  for (const name of ['onliner-photo-state.js','rental-onliner-photos.js','rental-form.js'])
    w.eval(fs.readFileSync(path.join(__dirname,'..',name),'utf8'));
  const control = {field:'onliner.images',action:'files',selector:'input[type=file]',
    previewSelector:'.new-photos__thumbnail-figure:has(img[src^="https://content.onliner.by/apartments_photo/"]):has(.new-photos__thumbnail-remove)'};
  function item(hash, status='processed') {
    const p={hash,status,preview:'https://content.onliner.by/apartments_photo/'+hash+'.jpg'};
    photos.items.push(p);
    const e=w.document.createElement('div');e.className='new-photos__thumbnail-figure';
    e.innerHTML=`<img src="${p.preview}"><a class="new-photos__thumbnail-remove">Удалить</a>`;
    e.querySelector('a').onclick=()=>{e.remove();photos.items.splice(photos.items.indexOf(p),1);};
    w.document.body.append(e);
    return {p,e};
  }
  const form = new w.AutopostRentalForm.Form({controls:[control]},[{name:'photo.png',dataUrl:'data:image/png;base64,YQ=='}]);
  return {w,photos,form,control,item};
}

test('Onliner acknowledges a duplicate only after the new upload hash matches a processed retained photo', async t => {
  const f=await setup(t), old=f.item('same');
  await f.form.tick();await f.form.tick();
  assert.equal(f.form.done.size,0);
  // Native uploader removes the duplicate item but retains its acknowledgement in the queue.
  f.photos.uploadQueue.push({item:{hash:'same',status:'pending'}});
  await f.form.tick();
  assert.equal(f.form.done.has(f.control.field),true);
  assert.equal(old.e.isConnected,true);
  assert.equal(f.photos.items.length,1);
});

test('Onliner leaves previous photos intact on an upload failure or a different unresolved hash', async t => {
  const f=await setup(t), old=f.item('old');
  await f.form.tick();
  f.photos.uploadQueue.push({item:{hash:'',status:'error'}});
  for(let i=0;i<3;i++) await f.form.tick();
  assert.equal(f.form.done.size,0);assert.equal(old.e.isConnected,true);
  f.photos.uploadQueue[0].item.hash='different';
  await f.form.tick();
  assert.equal(f.form.done.size,0);assert.equal(old.e.isConnected,true);
});

test('Onliner replaces previous photos only when every requested hash has a processed image', async t => {
  const f=await setup(t), old=f.item('old');
  await f.form.tick();
  const fresh=f.item('new','processing');
  await f.form.tick();
  assert.equal(old.e.isConnected,true);assert.equal(f.form.done.size,0);
  fresh.p.status='processed';
  await f.form.tick();await f.form.tick();
  assert.equal(old.e.isConnected,false);assert.equal(fresh.e.isConnected,true);
  assert.equal(f.form.done.size,1);
});

test('Onliner ignores acknowledgements from earlier jobs', async t => {
  const f=await setup(t);f.item('same');
  f.photos.uploadQueue.push({item:{hash:'same',status:'pending'}});
  await f.form.tick();await f.form.tick();
  assert.equal(f.form.done.size,0);
});
