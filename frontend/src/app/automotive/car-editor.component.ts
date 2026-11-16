import {Component,HostListener,Input,OnInit,OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {KeyValuePipe} from '@angular/common';
import {CarGateway} from './car.gateway';
import {SearchSelectComponent} from '../search-select.component';
import type {CarSchema,CarCard,CarOption,CarField,CarPrepared,CarJob,CarCandidates} from './car-models';
import {EXTENSION_VERSION,type Photo} from '../../../../lib/workspace';
import type {RentalProfile} from '../rental/rental-profile-defaults';

@Component({selector:'app-car-editor',standalone:true,imports:[FormsModule,KeyValuePipe,SearchSelectComponent],templateUrl:'./car-editor.component.html',styleUrl:'./car-editor.component.css'})
export class CarEditorComponent implements OnInit,OnDestroy {
 @Input() workspaceId='';@Input() profileDefaults:RentalProfile={};
 schema?:CarSchema;card:CarCard={values:{},extras:{},platforms:['kufar','onliner','av','abw']};
 picks:Record<string,string>={};options:Record<string,CarOption[]>={};queries:Record<string,string>={};totals:Record<string,number>={};
 loadingOptions:Record<string,boolean>={};optionErrors:Record<string,string>={};
 description='';recognizedText='';photos:Photo[]=[];busy='';error='';notes:string[]=[];evidence:Record<string,string>={};
 candidateFilters:Record<string,string[]>={};candidateReasons:Record<string,string>={};
 private flatCache:Record<string,CarOption[]>={};private lastPhotoText='';
 private photoAnalysis:CarCandidates={warnings:[]};
 private aiAssigned:Record<string,unknown>={};
 private candidateAssigned:Record<string,unknown>={};private candidateRevision=0;
 prepared?:CarPrepared;jobs:CarJob[]=[];ready=false;version=EXTENSION_VERSION;
 connectionMessage='';private connecting?:Promise<void>;
 private alive=true;private requests:Record<string,number>={};private revision=1;private sessionId=crypto.randomUUID();private timer?:ReturnType<typeof setInterval>;
 constructor(private gateway:CarGateway){}
 async ngOnInit(){await this.run(async()=>{this.schema=await this.gateway.editor();if(!this.alive)return;
  if(this.profileDefaults.phone)this.card.values['car.phone']=this.profileDefaults.phone;
  if(this.profileDefaults.contactPerson)this.card.values['car.seller_name']=this.profileDefaults.contactPerson;
  await Promise.all(this.schema.fields.filter(f=>this.isChoice(f)&&!f.parent_option_id).map(f=>this.loadOptions(f)));
 });void this.connect();this.timer=setInterval(()=>void this.refresh(),3000);}
 ngOnDestroy(){this.alive=false;clearInterval(this.timer);}
 async run(action:()=>Promise<void>,label='Загружаем…'){if(this.busy)return;this.busy=label;this.error='';try{await action();}catch(e){this.error=(e as Error).message;}finally{this.busy='';}}
 change(){this.revision++;this.prepared=undefined;}
 isChoice(f:CarField){return f.type==='enum'||f.control==='select';}
 private inputValue(f:CarField,v:unknown){return (f.type==='integer'||f.type==='number')&&typeof v==='string'&&v.trim()!==''?Number(v):v;}
 set(f:CarField,v:unknown){this.card.values[f.id]=this.inputValue(f,v);delete this.evidence[f.id];delete this.aiAssigned[f.id];this.change();}
 async loadOptions(f:CarField,append=false){
  if(append&&this.loadingOptions[f.id])return;
  const request=this.requests[f.id]=(this.requests[f.id]||0)+1,parent=f.parent_option_id?this.picks[f.parent_option_id]||'':'';
  delete this.optionErrors[f.id];
  if(f.parent_option_id&&!parent){this.options[f.id]=[];this.totals[f.id]=0;this.loadingOptions[f.id]=false;return;}
  this.loadingOptions[f.id]=true;if(!append){this.options[f.id]=[];this.totals[f.id]=0;}
  try{
   const allowed=this.candidateFilters[f.id];
   if(allowed){
    let all=this.flatCache[f.id];
    if(!all){all=[];let total=Infinity;while(all.length<total){const page=await this.gateway.options(f.id,'','',all.length);if(!this.alive||request!==this.requests[f.id])return;if(!page.items.length)break;all.push(...page.items);total=page.total;}this.flatCache[f.id]=all;}
    if(!this.alive||request!==this.requests[f.id])return;
    const query=(this.queries[f.id]||'').toLocaleLowerCase().replaceAll('ё','е');
    this.options[f.id]=all.filter(o=>allowed.includes(o.id)&&[o.name,...o.aliases||[]].some(n=>n.toLocaleLowerCase().replaceAll('ё','е').includes(query)));
    this.totals[f.id]=this.options[f.id].length;return;
   }
   const response=await this.gateway.options(f.id,parent,this.queries[f.id]||'',append?(this.options[f.id]?.length||0):0);
   if(!this.alive||request!==this.requests[f.id])return;
   this.options[f.id]=append?[...(this.options[f.id]||[]),...response.items]:response.items;this.totals[f.id]=response.total;
   if(this.technicalField(f)&&!this.queries[f.id]&&!append&&response.items.length===response.total)this.flatCache[f.id]=response.items;
  }catch(e){if(request===this.requests[f.id])this.optionErrors[f.id]=(e as Error).message;}
  finally{if(request===this.requests[f.id])this.loadingOptions[f.id]=false;}
 }
 search(f:CarField,query:string){this.queries[f.id]=query;void this.loadOptions(f);}
 private technicalField(f:CarField){return ['car.year','car.body','car.engine','car.drive','car.transmission','car.color','car.seats','car.interior_material','car.interior_color'].includes(f.id);}
 async applyCandidates(result:CarCandidates,selectSingle=false){
  const revision=++this.candidateRevision;let changed=false;
  for(const [id,value] of Object.entries(this.candidateAssigned))if(this.card.values[id]===value){delete this.card.values[id];this.picks[id]='';delete this.evidence[id];delete this.aiAssigned[id];changed=true;}
  this.candidateAssigned={};if(changed)this.change();
  const affected=new Set(Object.keys(this.candidateFilters));this.candidateFilters={};this.candidateReasons={};
  for(const f of this.schema?.fields||[]){const ids=result.candidates?.[f.id];if(this.technicalField(f)&&Array.isArray(ids)&&ids.length){this.candidateFilters[f.id]=[...new Set(ids)];this.candidateReasons[f.id]=result.candidateEvidence?.[f.id]||'';affected.add(f.id);}}
  for(const id of affected){const f=this.schema?.fields.find(f=>f.id===id);if(f){
   this.queries[id]='';await this.loadOptions(f);if(!this.alive||revision!==this.candidateRevision)return;
   const ids=this.candidateFilters[id],current=this.card.values[id];
   if(selectSingle&&ids?.length===1&&(current==null||current===''||(current!==ids[0]&&current===this.aiAssigned[id]))&&this.options[id]?.some(o=>o.id===ids[0])){
    const value=this.inputValue(f,ids[0]);this.card.values[id]=value;this.picks[id]=ids[0];this.candidateAssigned[id]=value;this.aiAssigned[id]=value;this.evidence[id]=this.candidateReasons[id]||'Единственный вариант ИИ';this.change();
   }
  }}
 }
 async showAll(f:CarField){delete this.candidateFilters[f.id];delete this.candidateReasons[f.id];this.queries[f.id]='';await this.loadOptions(f);}
 sourceTextChanged(source='description'){if(source==='recognized')this.photoAnalysis={warnings:[]};void this.applyCandidates({warnings:[]});}
 async select(f:CarField,id:string){
  if(['car.brand','car.model','car.generation'].includes(f.id))this.photoAnalysis={warnings:[]};
  const clearing=['car.brand','car.model','car.generation'].includes(f.id)?this.applyCandidates({warnings:[]}):Promise.resolve();
  this.picks[f.id]=id;const root=f.root||f.id;
  delete this.aiAssigned[root];delete this.candidateAssigned[root];
  const clear=(parent:string)=>{for(const child of this.schema!.fields.filter(c=>c.parent_option_id===parent)){this.picks[child.id]='';this.options[child.id]=[];this.queries[child.id]='';this.totals[child.id]=0;this.loadingOptions[child.id]=false;delete this.optionErrors[child.id];this.requests[child.id]=(this.requests[child.id]||0)+1;clear(child.id);}};clear(f.id);
  this.card.values[root]=this.inputValue(f,id||(f.parent_option_id?this.picks[f.parent_option_id]||'':''));delete this.evidence[root];this.change();
  for(const child of this.schema!.fields.filter(c=>c.parent_option_id===f.id))await this.loadOptions(child);
  await clearing;
 }
 private clearTree(root:string){for(const f of this.schema?.fields||[])if((f.root||f.id)===root){this.picks[f.id]='';this.options[f.id]=[];this.queries[f.id]='';this.totals[f.id]=0;this.requests[f.id]=(this.requests[f.id]||0)+1;this.loadingOptions[f.id]=false;delete this.optionErrors[f.id];delete this.evidence[f.id];}}
 async restoreTree(root:string,id:string,selectedPath?:CarOption[]){
  const result=selectedPath?{path:selectedPath}:await this.gateway.selection(id);this.clearTree(root);for(const n of result.path){if(n.field){this.picks[n.field]=n.id;const f=this.schema!.fields.find(f=>f.id===n.field);if(f){await this.loadOptions(f);if(!this.options[f.id].some(o=>o.id===n.id))this.options[f.id].push(n);}}}
  const last=result.path.at(-1);for(const child of this.schema!.fields.filter(f=>f.parent_option_id===last?.field))await this.loadOptions(child);
 }
 togglePlatform(id:string,checked:boolean){this.card.platforms=checked?[...new Set([...this.card.platforms,id])]:this.card.platforms.filter(p=>p!==id);this.change();}
 extra(f:CarField,value:unknown){(this.card.extras[f.platform!]??={})[f.id]=this.inputValue(f,value);this.change();}
 private readonly emptySelection:string[]=[];
 extraValue(f:CarField):any{return this.card.extras[f.platform!]?.[f.id]??(f.type==='multi_enum'?this.emptySelection:'');}
 extraFields(platform:string){return this.schema?.extras.filter(f=>f.platform===platform&&f.type!=='files')||[];}
 async addPhotos(event:Event){const input=event.target as HTMLInputElement,files=Array.from(input.files||[]);if(!files.length)return;await this.run(async()=>{this.photos.push(...await this.gateway.photos(files));await this.photoContextChanged();this.change();},'Обрабатываем фото…');input.value='';}
 async removePhoto(id:string){this.photos=this.photos.filter(p=>p.id!==id);await this.photoContextChanged();this.change();}
 private async photoContextChanged(){if(this.recognizedText===this.lastPhotoText)this.recognizedText='';this.lastPhotoText='';this.photoAnalysis={warnings:[]};await this.applyCandidates({warnings:[]});}
 async recognizePhotos(){await this.run(async()=>{
  const before=this.photos.map(p=>p.id).join(',');const textBefore=this.recognizedText;
  const result=await this.gateway.recognizePhotos(this.photos);
  if(!this.alive||before!==this.photos.map(p=>p.id).join(',')||textBefore!==this.recognizedText)throw Error('Фотографии или текст изменились. Повторите распознавание.');
  this.recognizedText=result.text;this.lastPhotoText=result.text;this.photoAnalysis={candidates:result.candidates,candidateEvidence:result.candidateEvidence,...(result.generationHint?{generationHint:result.generationHint}:{}),...(result.observations?{observations:result.observations}:{}),warnings:[]};this.notes=result.warnings;await this.applyCandidates(result,true);this.change();
  this.busy='Заполняем поля по распознанному автомобилю…';
  await this.analyzeFields();this.notes=[...new Set([...result.warnings,...this.notes])];
 },'Распознаём фотографии…');}
 async analyze(){await this.run(()=>this.analyzeFields(),'Заполняем поля…');}
 private async analyzeFields(){
   const before=JSON.stringify(this.card.values),texts=[this.description,this.recognizedText].join('\n');const result=await this.gateway.analyze(this.description,this.recognizedText,this.photoAnalysis);
   if(!this.alive||before!==JSON.stringify(this.card.values)||texts!==[this.description,this.recognizedText].join('\n'))throw Error('Поля изменились во время распознавания. Повторите запрос.');
   for(const [key,old] of Object.entries(this.aiAssigned))if(!(key in result.values)&&this.card.values[key]===old){delete this.card.values[key];delete this.aiAssigned[key];this.clearTree(key);delete this.evidence[key];}
   for(const [key,value]of Object.entries(result.values)){
    const current=this.card.values[key],f=this.schema!.fields.find(f=>f.id===key);let path:CarOption[]|undefined;let refinedManual=false;
    let replace=current==null||current===''||(key in this.aiAssigned&&current===this.aiAssigned[key]);
    if(!replace&&f?.root===key){path=(await this.gateway.selection(String(value))).path;replace=path.some(n=>n.id===current)&&current!==value;refinedManual=replace;}
    if(!replace)continue;
    if(f?.type==='enum')await this.restoreTree(key,String(value),path);
    else if(f&&this.isChoice(f))this.picks[key]=String(value);
    this.card.values[key]=value;delete this.candidateAssigned[key];if(!refinedManual)this.aiAssigned[key]=value;this.evidence[key]=result.evidence[key]||'Предложение ИИ — проверьте';
   }
   await this.applyCandidates(result,true);
   if(!this.card.values['car.description'])this.card.values['car.description']=this.description;
   this.notes=result.warnings;this.change();
 }
 async check(){await this.run(async()=>{this.prepared=await this.gateway.prepare(this.card);},'Проверяем карточку…');}
 @HostListener('window:focus')
 connect():Promise<void>{
  if(!this.alive)return Promise.resolve();
  if(this.connecting)return this.connecting;
  this.connecting=(async()=>{try{const p=await this.gateway.extension('PING');if(!this.alive)return;
   this.ready=Array.isArray(p['capabilities'])&&p['capabilities'].includes('cars-publishing-v1');
   if(this.ready&&this.error===this.connectionMessage)this.error='';
   this.connectionMessage=this.ready?'':`Подключённое расширение ${p['version']||''} не поддерживает автомобили. Обновите расширение до ${this.version}.`;
  }catch(e){if(this.alive){this.ready=false;this.connectionMessage=(e as Error).message;}}})();
  return this.connecting.finally(()=>{this.connecting=undefined;});
 }
 @HostListener('window:message',['$event'])
 onExtensionReady(event:MessageEvent){if(event.source===window&&event.origin===location.origin&&event.data?.source==='autopost-extension'&&event.data.type==='READY')void this.connect();}
 async publish(){await this.run(async()=>{if(!this.ready)await this.connect();if(!this.ready)throw Error(this.connectionMessage||'Нет связи с расширением. Проверьте подключение.');const r=await this.gateway.extension('RENTAL_RUN',{categoryId:'cars_used_sale',profileId:this.workspaceId,id:this.sessionId,revision:this.revision,card:this.card,photos:this.photos,mode:'assist'});this.jobs=(r['jobs']||[]) as CarJob[];},'Открываем площадки…');}
 async refresh(){if(!this.ready||!this.jobs.length)return;try{const r=await this.gateway.extension('RENTAL_STATUS',{categoryId:'cars_used_sale',profileId:this.workspaceId,id:this.sessionId});if(this.alive)this.jobs=(r['jobs']||[]) as CarJob[];}catch{/* retain last known progress */}}
 async jobAction(type:string,jobId?:string){await this.run(async()=>{await this.gateway.extension(type,{categoryId:'cars_used_sale',profileId:this.workspaceId,id:this.sessionId,jobId});await this.refresh();});}
}
