import {describe,it,expect,vi} from 'vitest';
import {CarEditorComponent} from './car-editor.component';
import {CarGateway} from './car.gateway';
import {WorkspaceGateway} from '../workspace.gateway';
describe('cars editor',()=>{
 it('keeps a confirmed numeric year when generation changes and photo filters are cleared',async()=>{
  const year={id:'car.year',key:'year',name:'Год выпуска',type:'integer',control:'select' as const};
  const generation={id:'car.generation',key:'generation',name:'Поколение',type:'enum',root:'car.brand',parent_option_id:'car.model'};
  const c=new CarEditorComponent({options:vi.fn(async()=>({items:[{id:'2020',name:'2020'}],total:1})),analyze:vi.fn(async()=>({values:{'car.year':2020},evidence:{'car.year':'2020 года'},candidates:{'car.year':['2020']},warnings:[]}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields:[year,generation],extras:[],platforms:[]};
  await c.analyze();await c.select(generation,'generation');
  expect(c.card.values['car.year']).toBe(2020);expect(c.picks['car.year']).toBe('2020');c.ngOnDestroy();
 });
 it('uses year choices and restrictions while sending a numeric year and preserving manual selection',async()=>{
  const year={id:'car.year',key:'year',name:'Год выпуска',type:'integer',control:'select' as const};
  const items=[2026,2025,2024,2023,2022,2021,2020,2019].map(y=>({id:String(y),name:String(y)}));
  const c=new CarEditorComponent({options:vi.fn(async()=>({items,total:items.length})),analyze:vi.fn(async()=>({values:{'car.year':2020},evidence:{'car.year':'2020 года'},candidates:{'car.year':['2020']},warnings:[]}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields:[year],extras:[],platforms:[]};expect(c.isChoice(year)).toBe(true);
  await c.applyCandidates({candidates:{'car.year':['2019','2020']},warnings:[]},true);expect(c.options[year.id].map(o=>o.id)).toEqual(['2020','2019']);expect(c.card.values[year.id]).toBeUndefined();
  await c.applyCandidates({candidates:{'car.year':['2020']},warnings:[]},true);expect(c.card.values[year.id]).toBe(2020);expect(c.picks[year.id]).toBe('2020');
  await c.analyze();expect(c.card.values[year.id]).toBe(2020);expect(c.picks[year.id]).toBe('2020');
  await c.select(year,'2021');await c.applyCandidates({candidates:{'car.year':['2020']},warnings:[]},true);expect(c.card.values[year.id]).toBe(2021);
  await c.showAll(year);expect(c.options[year.id][0].name).toBe('2026');expect(c.card.values[year.id]).toBe(2021);c.ngOnDestroy();
 });
 it('uses stable empty multi-selections and sends numeric input as JSON numbers',()=>{
  const c=new CarEditorComponent({} as CarGateway),f={id:'test',key:'test',name:'Test',type:'multi_enum',platform:'abw'};
  expect(c.extraValue(f)).toBe(c.extraValue(f));
  c.set({...f,id:'car.year',type:'integer'},'2020');expect(c.card.values['car.year']).toBe(2020);
  c.extra({...f,type:'number'},'1.6');expect(c.card.extras['abw']['test']).toBe(1.6);
  c.set({...f,id:'car.year',type:'integer'},'');expect(c.card.values['car.year']).toBe('');
 });
 it('launches from the user click without a preceding asynchronous handshake',async()=>{
  const extension=vi.fn(async(_type:string,_payload?:unknown)=>({jobs:[]})),c=new CarEditorComponent({extension} as unknown as CarGateway);c.ready=true;
  await c.publish();expect(extension.mock.calls).toHaveLength(1);expect(extension.mock.calls[0][0]).toBe('RENTAL_RUN');
 });
 it('invalidates old dependent requests when the brand changes',async()=>{
  let finish:(x:any)=>void=()=>{};
  const gateway={options:vi.fn(()=>new Promise(r=>{finish=r;}))} as unknown as CarGateway;
  const c=new CarEditorComponent(gateway),brand={id:'car.brand',key:'brand',name:'Марка',type:'enum',root:'car.brand'},model={id:'car.model',key:'model',name:'Модель',type:'enum',root:'car.brand',parent_option_id:'car.brand'};
  c.schema={categoryId:'cars_used_sale',fields:[brand,model],extras:[],platforms:[]};c.picks['car.brand']='old';
  const request=c.loadOptions(model);await c.select(brand,'');finish({items:[{id:'old-model',name:'Old'}],total:1});await request;
  expect(c.options['car.model']).toEqual([]);expect(c.card.values['car.brand']).toBe('');c.ngOnDestroy();
 });
 it('stores the selected model under the root and clears descendants',async()=>{
  const gateway={options:vi.fn(async()=>({items:[],total:0}))} as unknown as CarGateway;
  const c=new CarEditorComponent(gateway),model={id:'car.model',key:'model',name:'Модель',type:'enum',root:'car.brand',parent_option_id:'car.brand'};
  c.schema={categoryId:'cars_used_sale',fields:[model,{id:'car.generation',key:'generation',name:'Поколение',type:'enum',root:'car.brand',parent_option_id:'car.model'}],extras:[],platforms:[]};
  c.picks['car.brand']='brand';c.picks['car.generation']='old-generation';await c.select(model,'new-model');
  expect(c.card.values).toEqual({'car.brand':'new-model'});expect(c.picks['car.generation']).toBe('');c.ngOnDestroy();
 });
 it('restores navigation separately for each profile',()=>{
  const g=new WorkspaceGateway();g.rememberSection('cars-test-a','cars');g.rememberSection('cars-test-b','property');
  expect(g.activeSection('cars-test-a')).toBe('cars');expect(g.activeSection('cars-test-b')).toBe('property');
  sessionStorage.removeItem('autopost.active-section.cars-test-a');sessionStorage.removeItem('autopost.active-section.cars-test-b');
 });
 it('filters only technical choices, preserves manual values and restores all choices',async()=>{
  const transmission={id:'car.transmission',key:'transmission',name:'Коробка',type:'enum'},currency={id:'car.currency',key:'currency',name:'Валюта',type:'enum'};
  const items=[{id:'manual',name:'Механика'},{id:'auto',name:'Автомат'},{id:'robot',name:'Робот',aliases:['DSG']}];
  const gateway={options:vi.fn(async()=>({items,total:3}))} as unknown as CarGateway,c=new CarEditorComponent(gateway);
  c.schema={categoryId:'cars_used_sale',fields:[transmission,currency],extras:[],platforms:[]};c.card.values[transmission.id]='manual';c.picks[transmission.id]='manual';
  await c.applyCandidates({candidates:{'car.transmission':['auto','robot'],'car.currency':['auto']},candidateEvidence:{'car.transmission':'Несколько коробок'},warnings:[]});
  expect(c.options[transmission.id].map(o=>o.id)).toEqual(['auto','robot']);expect(c.candidateFilters[currency.id]).toBeUndefined();expect(c.card.values[transmission.id]).toBe('manual');
  c.queries[transmission.id]='dsg';await c.loadOptions(transmission);expect(c.options[transmission.id].map(o=>o.id)).toEqual(['robot']);
  await c.showAll(transmission);expect(c.options[transmission.id]).toEqual(items);expect(c.candidateFilters).toEqual({});c.ngOnDestroy();
 });
 it('edits invalidate suggestions and changing the brand does not wait for flat requests',async()=>{
  let finish:(x:any)=>void=()=>{};
  const field={id:'car.engine',key:'engine',name:'Двигатель',type:'enum'},brand={id:'car.brand',key:'brand',name:'Марка',type:'enum',root:'car.brand'};
  const c=new CarEditorComponent({options:vi.fn(()=>new Promise(r=>finish=r))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields:[field,brand],extras:[],platforms:[]};c.candidateFilters[field.id]=['old'];
  const selecting=c.select(brand,'new-brand');expect(c.picks[brand.id]).toBe('new-brand');expect(c.candidateFilters).toEqual({});finish({items:[],total:0});await selecting;
  c.candidateFilters[field.id]=['old'];c.sourceTextChanged();expect(c.candidateFilters).toEqual({});finish({items:[],total:0});c.ngOnDestroy();
 });
 it('selects single photo choices immediately, clears expanded choices and preserves manual input',async()=>{
  const field={id:'car.transmission',key:'transmission',name:'Коробка',type:'enum'},items=[{id:'auto',name:'Автомат'},{id:'manual',name:'Механика'}];
  const c=new CarEditorComponent({options:vi.fn(async()=>({items,total:2})),recognizePhotos:vi.fn(async()=>({text:'Продаётся автомобиль.',candidates:{'car.transmission':['auto']},warnings:[]})),analyze:vi.fn(async()=>({values:{},evidence:{},candidates:{'car.transmission':['auto']},warnings:[]}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields:[field],extras:[],platforms:[]};await c.recognizePhotos();
  expect(c.card.values[field.id]).toBe('auto');expect(c.candidateFilters[field.id]).toEqual(['auto']);
  await c.analyze();expect(c.card.values[field.id]).toBe('auto');expect(c.picks[field.id]).toBe('auto');
  await c.applyCandidates({candidates:{'car.transmission':['auto','manual']},warnings:[]});expect(c.card.values[field.id]).toBeUndefined();expect(c.picks[field.id]).toBe('');
  await c.applyCandidates({candidates:{'car.transmission':['auto']},warnings:[]},true);await c.select(field,'auto');
  await c.applyCandidates({candidates:{'car.transmission':['manual']},warnings:[]},true);expect(c.card.values[field.id]).toBe('auto');c.ngOnDestroy();
 });
 it('selects the sole candidate from text analysis even without a fact and clears it on source changes',async()=>{
  const field={id:'car.engine',key:'engine',name:'Двигатель',type:'enum'};
  const c=new CarEditorComponent({options:vi.fn(async()=>({items:[{id:'petrol',name:'Бензин'}],total:1})),analyze:vi.fn(async()=>({values:{},evidence:{},candidates:{'car.engine':['petrol']},warnings:[]}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields:[field],extras:[],platforms:[]};await c.analyze();expect(c.card.values[field.id]).toBe('petrol');
  await c.analyze();expect(c.card.values[field.id]).toBe('petrol');c.sourceTextChanged();expect(c.card.values[field.id]).toBeUndefined();c.ngOnDestroy();
 });
 it('recognizes and automatically sends both texts once without overwriting manual values',async()=>{
  const gateway={recognizePhotos:vi.fn(async()=>({text:'Возможно Kia Rio',generationHint:'Kia Rio IV по форме фар',warnings:[],collage:{photoCount:1,bytes:120,width:512,height:512}})),analyze:vi.fn(async()=>({values:{'car.price':5000,'car.mileage':60000},evidence:{'car.price':'ИИ','car.mileage':'60000'},warnings:[]}))} as unknown as CarGateway;
  const c=new CarEditorComponent(gateway);c.schema={categoryId:'cars_used_sale',fields:[],extras:[],platforms:[]};c.description='Мой текст';c.card.values['car.price']=6500;
  c.photos=[{id:'one',dataUrl:'data:image/jpeg;base64,one',name:'one.jpg'} as any];
  await c.recognizePhotos();expect(c.recognizedText).toBe('Возможно Kia Rio');expect(c.error).toBe('');
  expect(gateway.analyze).toHaveBeenCalledExactlyOnceWith('Мой текст','Возможно Kia Rio',{candidates:undefined,candidateEvidence:undefined,generationHint:'Kia Rio IV по форме фар',warnings:[]});expect(c.card.values['car.price']).toBe(6500);expect(c.card.values['car.mileage']).toBe(60000);
  await c.removePhoto('one');expect(c.recognizedText).toBe('');c.ngOnDestroy();
 });
 it('retains an edited recognition text on photo changes and a failed recognition',async()=>{
  const c=new CarEditorComponent({recognizePhotos:vi.fn(async()=>{throw Error('Unavailable');})} as unknown as CarGateway);
  c.recognizedText='Моя правка';await c.removePhoto('one');expect(c.recognizedText).toBe('Моя правка');
  await c.recognizePhotos();expect(c.recognizedText).toBe('Моя правка');expect(c.error).toBe('Unavailable');c.ngOnDestroy();
 });
 it('keeps photo text and single choices when automatic text analysis fails, and can retry filling',async()=>{
  const field={id:'car.body',key:'body',name:'Кузов',type:'enum'};
  const analyze=vi.fn().mockRejectedValueOnce(Error('Text AI unavailable')).mockResolvedValue({values:{'car.year':2020},evidence:{},candidates:{'car.body':['sedan']},warnings:[]});
  const recognizePhotos=vi.fn(async()=>({text:'Продаётся седан.',candidates:{'car.body':['sedan']},warnings:[]}));
  const c=new CarEditorComponent({analyze,recognizePhotos,options:vi.fn(async()=>({items:[{id:'sedan',name:'Седан'}],total:1}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields:[field],extras:[],platforms:[]};await c.recognizePhotos();
  expect(c.recognizedText).toBe('Продаётся седан.');expect(c.card.values['car.body']).toBe('sedan');expect(c.error).toBe('Text AI unavailable');expect(c.busy).toBe('');
  await c.analyze();expect(c.card.values['car.year']).toBe(2020);expect(c.card.values['car.body']).toBe('sedan');expect(c.error).toBe('');expect(recognizePhotos).toHaveBeenCalledTimes(1);c.ngOnDestroy();
 });
 it('fills the brand, model and generation after photo recognition without a second button press',async()=>{
  const fields=[{id:'car.brand',key:'brand',name:'Марка',type:'enum',root:'car.brand'},{id:'car.model',key:'model',name:'Модель',type:'enum',root:'car.brand',parent_option_id:'car.brand'},{id:'car.generation',key:'generation',name:'Поколение',type:'enum',root:'car.brand',parent_option_id:'car.model'}];
  const path=fields.map((f,i)=>({id:['bmw','seven','g12'][i],field:f.id,name:f.name}));
  const c=new CarEditorComponent({recognizePhotos:vi.fn(async()=>({text:'Продаётся BMW 7 серии.',generationHint:'G12',warnings:['Проверьте поколение']})),analyze:vi.fn(async()=>({values:{'car.brand':'g12'},evidence:{},warnings:[]})),selection:vi.fn(async()=>({path})),options:vi.fn(async()=>({items:[],total:0}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields,extras:[],platforms:[]};await c.recognizePhotos();
  expect(c.card.values['car.brand']).toBe('g12');expect(c.picks).toEqual({'car.brand':'bmw','car.model':'seven','car.generation':'g12'});expect(c.notes).toContain('Проверьте поколение');expect(c.error).toBe('');c.ngOnDestroy();
 });
 it('discards a response when source text changed while AI was running',async()=>{
  let finish:(x:any)=>void=()=>{};
  const c=new CarEditorComponent({analyze:vi.fn(()=>new Promise(r=>finish=r))} as unknown as CarGateway);c.description='Первый текст';
  const pending=c.analyze();c.description='Другой текст';finish({values:{'car.price':1},evidence:{},warnings:[]});await pending;
  expect(c.card.values).toEqual({});expect(c.error).toContain('изменились');c.ngOnDestroy();
 });
 it('recovers option errors independently without clearing unrelated action errors',async()=>{
  const options=vi.fn().mockRejectedValueOnce(Error('Network unavailable')).mockResolvedValue({items:[{id:'diesel',name:'Дизель'}],total:1});
  const c=new CarEditorComponent({options} as unknown as CarGateway),field={id:'car.engine',key:'engine',name:'Двигатель',type:'enum'};
  c.error='Separate photo error';await c.loadOptions(field);expect(c.optionErrors[field.id]).toBe('Network unavailable');
  await c.loadOptions(field);expect(c.optionErrors[field.id]).toBeUndefined();expect(c.options[field.id][0].id).toBe('diesel');expect(c.error).toBe('Separate photo error');c.ngOnDestroy();
 });
 it('fills cleared numeric fields, replaces earlier AI values and preserves manual edits including zero',async()=>{
  const analyze=vi.fn().mockResolvedValueOnce({values:{'car.year':2020,'car.mileage':10000,'car.price':20000},evidence:{},warnings:[]}).mockResolvedValueOnce({values:{'car.year':2021,'car.mileage':12000},evidence:{},warnings:[]});
  const c=new CarEditorComponent({analyze} as unknown as CarGateway);c.schema={categoryId:'cars_used_sale',fields:[],extras:[],platforms:[]};c.card.values['car.year']=null;
  await c.analyze();expect(c.card.values['car.year']).toBe(2020);
  c.set({id:'car.mileage',key:'mileage',name:'Пробег',type:'integer'},0);await c.analyze();
  expect(c.card.values['car.year']).toBe(2021);expect(c.card.values['car.mileage']).toBe(0);expect(c.card.values['car.price']).toBeUndefined();c.ngOnDestroy();
 });
 it('fills a missing model and generation under the manually selected matching brand',async()=>{
  const fields=[{id:'car.brand',key:'brand',name:'Марка',type:'enum',root:'car.brand'},{id:'car.model',key:'model',name:'Модель',type:'enum',root:'car.brand',parent_option_id:'car.brand'},{id:'car.generation',key:'generation',name:'Поколение',type:'enum',root:'car.brand',parent_option_id:'car.model'}];
  const path=fields.map((f,i)=>({id:['kia','rio','iv'][i],field:f.id,name:f.name}));
  const c=new CarEditorComponent({analyze:vi.fn(async()=>({values:{'car.brand':'iv'},evidence:{},warnings:[]})),selection:vi.fn(async()=>({path})),options:vi.fn(async()=>({items:[],total:0}))} as unknown as CarGateway);
  c.schema={categoryId:'cars_used_sale',fields,extras:[],platforms:[]};c.card.values['car.brand']='kia';c.picks['car.brand']='kia';await c.analyze();
  expect(c.picks).toEqual({'car.brand':'kia','car.model':'rio','car.generation':'iv'});expect(c.card.values['car.brand']).toBe('iv');c.ngOnDestroy();
 });
});

it('rejects photo recognition when a photo beyond the first six changed',async()=>{
 let finish:(x:any)=>void=()=>{};
 const analyze=vi.fn();const c=new CarEditorComponent({recognizePhotos:vi.fn(()=>new Promise(r=>finish=r)),analyze} as unknown as CarGateway);
 c.photos=Array.from({length:20},(_,i)=>({id:String(i),name:i+'.jpg',dataUrl:'data:image/jpeg;base64,x'} as any));
 const pending=c.recognizePhotos();c.photos[19]={...c.photos[19],id:'replacement'};finish({text:'Старый результат',warnings:[]});await pending;
 expect(c.recognizedText).toBe('');expect(c.error).toContain('изменились');expect(analyze).not.toHaveBeenCalled();c.ngOnDestroy();
});
it('allows adding a batch larger than twelve photos',async()=>{
 const photos=Array.from({length:20},(_,i)=>({id:String(i),name:i+'.jpg',dataUrl:'data:image/jpeg;base64,x'} as any));
 const c=new CarEditorComponent({photos:vi.fn(async()=>photos)} as unknown as CarGateway);
 await c.addPhotos({target:{files:[new File(['x'],'photo.jpg')],value:'photo.jpg'}} as any);expect(c.photos).toHaveLength(20);expect(c.error).toBe('');c.ngOnDestroy();
});
