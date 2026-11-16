// Enrich only public option dictionaries and static UI evidence from the user's saved HAR.
import fs from 'node:fs';import {createHash} from 'node:crypto';
const [file]=process.argv.slice(2);if(!file)throw Error('Expected saved abw-cities.har');
const har=JSON.parse(fs.readFileSync(file,'utf8')),dir='data/parsing/cars_used_sale';
const read=n=>JSON.parse(fs.readFileSync(dir+'/'+n,'utf8'));
const entry=har.log.entries.find(e=>e.request.url==='https://b.abw.by/api/v2/create/options'&&e.response.status===200&&e.response.content.text);
const data=JSON.parse(entry.response.content.text);
const script=har.log.entries.find(e=>e.request.url.endsWith('/CO-G6gw6.js')&&e.response.content.text)?.response.content.text;
if(!script?.includes('{value:"byn",label:"Br"},{value:"usd",label:"$"},{value:"eur",label:"€"},{value:"rub",label:"₽"}'))throw Error('Currency evidence changed');
const schema=read('cars_used_sale_abw.json'),binding=read('binding_cars_used_sale_abw.json'),state=read('evidence/abw-catalog-source.json');
const normal=s=>s.toLowerCase().replaceAll('ё','е');
const choices=(key,items,old=[])=>items.map(o=>({id:old.find(c=>c.value===o.id||c.value===null&&normal(c.name)===normal(o.title))?.id||'abw.'+key+'.'+encodeURIComponent(typeof o.id+':'+JSON.stringify(o.id)),name:o.title,type:'choice',value:o.id,description:'Публичный справочник create/options ABW.',options:[]}));
for(const [api,key]of Object.entries({engine:'engine',gear:'gear',transmission:'transmission',color:'color',state:'condition',availability:'availability'})){
 const field=schema[0].options.find(f=>f.id==='abw.'+key);if(!Array.isArray(data[api]))throw Error('Missing '+api);
 // The initial dictionary is complete for this endpoint; preserve historical additional observed values.
 const merged=choices(key,data[api],field.options);for(const o of field.options)if(!merged.some(n=>n.value===o.value||normal(n.name)===normal(o.name)))merged.push(o);
 field.options=merged;field.options_complete=false;field.description+=' Дополнено исходным справочником create/options, без удаления ранее наблюдавшихся вариантов.';
 state.flat[key]=merged.map(o=>({name:o.name,value:o.value,children:[],listComplete:false}));
}
const currency={id:'abw.currency',name:'Валюта',type:'enum',required:null,description:'Коды и символы из FormPrice в клиенте ABW, сохранённом в HAR. Чтение и установка в живой форме ещё не проверены.',options_complete:true,options:choices('currency',[{id:'byn',title:'BYN'},{id:'usd',title:'USD'},{id:'eur',title:'EUR'},{id:'rub',title:'RUB'}])};
schema[0].options=schema[0].options.filter(f=>f.id!=='abw.currency');schema[0].options.push(currency);
state.flat.currency=currency.options.map(o=>({name:o.name,value:o.value,children:[],listComplete:true}));
if(!binding.fields.some(b=>b.option_id==='abw.currency'))binding.fields.push({option_id:'abw.currency',status:'needs_review',reason:currency.description});
const evidence={source:'User-exported abw-cities.har',endpoint:entry.request.url,script_sha256:createHash('sha256').update(script).digest('hex'),options:Object.fromEntries(['engine','gear','transmission','color','state','availability'].map(k=>[k,data[k].map(({id,title})=>({id,title}))])),currency:currency.options.map(o=>({id:o.value,title:o.name})),browser_fill_verified:false};
for(const [name,v]of Object.entries({'cars_used_sale_abw.json':schema,'binding_cars_used_sale_abw.json':binding,'evidence/abw-catalog-source.json':state,'evidence/abw-static-form-review.json':evidence}))fs.writeFileSync(dir+'/'+name,JSON.stringify(v,null,2)+'\n');
const overrides={abw:{}};
for(const key of ['brand','model','year','generation','body','engine','gear','transmission','color','condition','availability']){
 const field=schema[0].options.find(f=>f.id==='abw.'+key),api=key==='condition'?'state':key;
 overrides.abw[field.id]={status:'needs_review',reason:'Рецепт выведен из сохранённого клиента FormItem/FormItemBrandOrModel; проверен на локальной форме, не на живом ABW.',action:'choose',match:'text',
 target:{label:field.name,labels:'.item-title',container:'.adverts-form-item',selector:'.item-header'},suggestions:{selector:`.list_${api} .card_${api}, .popup__item`},verify:{kind:'selected_text_equals',within_target:'.item-selected'},
 ...(key==='brand'||key==='model'?{searchSelector:`input[placeholder="${field.name}"]`}:{}),expandSelector:`.card_more-${api}`};
}
overrides.abw['abw.currency']={status:'needs_review',reason:currency.description,action:'choose',match:'text',target:{selectors:['.form__currency']},suggestions:{selector:'.form__currency-list-item'},displayLabels:{byn:'Br',usd:'$',eur:'€',rub:'₽'},verify:{kind:'selected_text_equals'}};
overrides.abw['abw.price']={status:'needs_review',reason:'Ввод цены по точной подписи из FormPrice; валюта выбирается первой.',action:'set_value',depends_on:['abw.currency'],verify:{kind:'value_equals'}};
fs.mkdirSync('data/automotive/cars_used_sale',{recursive:true});fs.writeFileSync('data/automotive/cars_used_sale/browser-overrides.json',JSON.stringify(overrides,null,2)+'\n');
console.log('ABW public options/currency and static binding evidence imported; no HTTP requests.');
