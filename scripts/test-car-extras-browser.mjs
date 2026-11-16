import assert from 'node:assert/strict';

// Exercise Angular's actual select value accessors and the real preparation endpoint.
export async function verifyCarExtras({page,origin}){
 const car=page.locator('app-car-editor');
 const panel=name=>car.locator('details').filter({has:page.locator('summary').filter({hasText:'Дополнительные поля '+name})});
 async function prepare(){
  const response=page.waitForResponse(r=>r.url()===origin+'/api/workspace/categories/cars_used_sale/prepare');
  await car.getByRole('button',{name:'Проверить карточку',exact:true}).click();
  const reply=await response;assert.equal(reply.status(),200,await reply.text());
  await car.getByRole('heading',{name:'Проверка переноса',exact:true}).waitFor();
  return {input:reply.request().postDataJSON(),output:await reply.json()};
 }
 const cases=[['Kufar','kufar','Тип автоматической передачи','kufar.cars_autogearbox','Автомат'],
  ['Onliner','onliner','Единица мощности','onliner.powerUnit','л.с.'],
  ['AV.by','av','Подраздел','av.condition_promotion','Автомобиль с пробегом'],
  ['ABW','abw','Наличие','abw.availability',null]];
 for(const [name,id,label,field,choice] of cases){
  const section=panel(name);await section.locator('summary').click();
  const control=section.getByLabel(label,{exact:true});
  const option=choice??await control.locator('option').nth(1).innerText();
  await control.selectOption({label:option});const result=await prepare();
  assert.equal(typeof result.input.extras[id][field],'string',field+' must send a scalar ID');
  await control.selectOption({label:'Не указано'});
  assert.equal((await prepare()).input.extras[id][field],undefined,field+' must be removed when cleared');
 }
 const onliner=panel('Onliner');
 const park=onliner.getByLabel('Парктроник',{exact:true});
 await park.selectOption([{label:'Парктроник задний'},{label:'Парктроник передний'}]);
 let result=await prepare();assert.deepEqual(result.input.extras.onliner['onliner.parktronic'],['onliner.parktronic.rear','onliner.parktronic.front']);
 await park.selectOption({label:'Не указано'});result=await prepare();assert.equal(result.input.extras.onliner['onliner.parktronic'],undefined);
 await onliner.getByLabel('CarPlay',{exact:true}).selectOption({label:'Нет'});
 result=await prepare();assert.equal(result.input.extras.onliner['onliner.carplay'],false);
 assert.equal(await onliner.getByLabel('Состояние',{exact:true}).count(),0);
 assert.equal(await onliner.getByLabel('Единица пробега',{exact:true}).count(),0);
 const prepared=result.output.platforms.find(p=>p.platform==='onliner');
 assert.equal(prepared.values['onliner.state'].value,'owned');
 assert.equal(prepared.values['onliner.odometerUnit'].name,'км');
 await onliner.getByLabel('CarPlay',{exact:true}).selectOption({label:'Не указано'});
 for(const [name]of cases)await panel(name).locator('summary').click();
 return 'Four scalar extras, multi-select clearing, boolean false, accessible labels and automatic state/units';
}
