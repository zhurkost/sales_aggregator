import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Replay recorded REAL model + application-service results through the production UI.
// This checks every displayed field and every technical dropdown, without calling marketplaces.
export async function verifyCarAiChain({page,origin,until,output,runtime,caseFile,photoDirectory}){
 const cases=JSON.parse(await readFile(caseFile,'utf8')),report=[];
 const endpoint=origin+'/api/workspace/categories/cars_used_sale/';
 await page.unroute(endpoint+'analyze');await page.unroute(endpoint+'recognize-photos');
 for(const sample of cases){
  assert(!sample.error,sample.error);let called=0,photoCalled=0;
  await page.reload();const car=page.locator('app-car-editor');await until(()=>car.getByLabel('Марка',{exact:true}).isEnabled(),'Ready for '+sample.id);
  await car.getByLabel('Расскажите об автомобиле',{exact:true}).fill(sample.input.description||'');
  await page.route(endpoint+'analyze',async route=>{
   called++;const body=route.request().postDataJSON();assert.equal(body.description,sample.input.description||'');assert.equal(body.recognizedText,sample.input.recognizedText||'');
   if(sample.photo)assert.deepEqual(body.photoAnalysis.candidates,sample.photo.candidates);
   await route.fulfill({json:sample.result});
  });
  if(sample.photo){
   assert(photoDirectory,'Provide the actual photo directory for photo-chain replay');
   const files=(await readdir(photoDirectory)).filter(n=>n.endsWith('.jpg')&&!n.includes('collage')).sort().slice(0,6).map(n=>path.join(photoDirectory,n));
   await page.route(endpoint+'recognize-photos',async route=>{photoCalled++;assert.equal(route.request().postDataJSON().images.length,6);await route.fulfill({json:sample.photo});});
   await car.locator('input[type=file]').setInputFiles(files);await until(()=>car.locator('.photos img').count().then(n=>n===6),'Six actual photos loaded');
   await car.getByRole('button',{name:'Распознать с ИИ',exact:true}).click();await until(()=>car.getByLabel('Распознано ИИ',{exact:true}).inputValue().then(v=>v===sample.photo.text),'Real photo response rendered');
   assert(!(await car.getByLabel('Распознано ИИ',{exact:true}).inputValue()).includes('Варианты характеристик:'));
  }else await car.getByLabel('Распознано ИИ',{exact:true}).fill(sample.input.recognizedText||'');

  if(!sample.photo)await car.getByRole('button',{name:'Заполнить с ИИ',exact:true}).click();await until(async()=>called===1&&await car.getByRole('button',{name:'Заполнить с ИИ',exact:true}).isEnabled(),'Analysis completed');
  assert.equal(await car.getByRole('alert').count(),0,await car.getByRole('alert').allTextContents());
  const autoValues={...sample.result.values};for(const [field,ids]of Object.entries(sample.result.candidates||{}))if(ids.length===1&&autoValues[field]==null)autoValues[field]=ids[0];
  const expected={};for(const [field,value]of Object.entries(autoValues)){
   let node=runtime.nodes[value];if(!node){expected[field]=String(value);continue;}
   while(node){expected[node.field]=node.name;node=runtime.nodes[node.parentId];}
  }
  if(!expected['car.description'])expected['car.description']=sample.input.description||'';
  const fields=[];
  for(const f of runtime.fields.filter(f=>f.type!=='files')){
   const value=await car.getByLabel(f.name,{exact:true}).inputValue();assert.equal(value,expected[f.id]||'',sample.id+': '+f.id);
   fields.push({field:f.id,value});
  }
  const filters=[];
  for(const f of runtime.fields.filter(f=>['car.body','car.engine','car.drive','car.transmission','car.color','car.seats','car.interior_material','car.interior_color'].includes(f.id))){
   await car.getByRole('combobox',{name:f.name,exact:true}).click();const menu=car.getByRole('listbox',{name:f.name,exact:true});
   const ids=sample.result.candidates?.[f.id],expectedNames=(ids?ids.map(id=>runtime.nodes[id]):Object.values(runtime.nodes).filter(n=>n.field===f.id)).map(n=>n.name).sort();
   await until(()=>menu.getByRole('option').count().then(n=>n===expectedNames.length+1),'Choices for '+f.id);
   const actualNames=(await menu.getByRole('option').allTextContents()).map(n=>n.replace(/✓$/,'').trim()).filter(n=>n!=='Не указано').sort();assert.deepEqual(actualNames,expectedNames,sample.id+' filter '+f.id);
   await car.getByLabel('Расскажите об автомобиле',{exact:true}).click();filters.push({field:f.id,restricted:!!ids,choices:actualNames});
  }
  report.push({id:sample.id,fields,filters,called,photoCalled});await page.screenshot({path:path.join(output,'chain-'+sample.id+'.png'),fullPage:true});
  await page.unroute(endpoint+'analyze');await page.unroute(endpoint+'recognize-photos');
 }
 await writeFile(path.join(output,'ai-chain-fields.json'),JSON.stringify(report,null,2));
 return cases.map(c=>'Recorded live AI → UI: '+c.id+'; all 23 fields and 8 technical dropdowns checked');
}
