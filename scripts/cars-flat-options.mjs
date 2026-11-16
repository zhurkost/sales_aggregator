const norm=s=>s.toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();
const aliases={
 color:{'серый / серебристый':'Серый','красный / оранжевый':'Красный','синий / фиолетовый':'Синий','желтый / золотистый':'Жёлтый','золотой':'Золотистый','черный':'Чёрный','желтый':'Жёлтый','зеленый':'Зелёный'},
 body:{'хэтчбек':'Хэтчбек','легковой фургон':'Фургон'},
 interior_material:{'кожа':'Натуральная кожа','комбинированный':'Комбинированные материалы'},
 interior_color:{'светлый салон':'Светлый','темный салон':'Тёмный','темный':'Тёмный','комби':'Комбинированный'},
};
export function flatName(field,name){
 if(field==='seats')return name.replace(/\s+мест(?:а|о)?$/i,'');
 if(field==='city')return name.replace(/\s*-\s*/g,'-');
 if(!['body','engine','drive','transmission','color','interior_material','interior_color'].includes(field))return name;
 const label=aliases[field]?.[norm(name)]||name;
 return label.charAt(0).toUpperCase()+label.slice(1);
}

// A broad site choice can serve several precise common colours/types without collapsing them.
export const flatMappingRules=[];
const add=(field,name,platform,native,assignments=[],match='broader')=>flatMappingRules.push({field,name,platform,native,match,...(assignments.length?{assignments}:{})});
for(const [name,native]of [['Серебристый','Серый / серебристый'],['Оранжевый','Красный / оранжевый'],['Фиолетовый','Синий / фиолетовый'],['Золотистый','Желтый / золотистый']])add('color',name,'kufar',native);
for(const [name,native]of [['Хэтчбек 3 дв.','Хэтчбек'],['Хэтчбек 5 дв.','Хэтчбек'],['Внедорожник 3 дв.','Внедорожник'],['Внедорожник 5 дв.','Внедорожник'],['Микроавтобус грузопассажирский','Микроавтобус'],['Микроавтобус пассажирский','Микроавтобус'],['Родстер','Кабриолет']])for(const p of ['kufar','onliner'])add('body',name,p,p==='onliner'&&native==='Хэтчбек'?'хетчбэк':native);
add('body','Родстер','abw','кабриолет');
for(const name of ['Подключаемый полный привод','Постоянный полный привод'])for(const p of ['kufar','onliner','abw'])add('drive',name,p,'полный');
for(const name of ['Робот','Вариатор']){
 add('transmission',name,'kufar','Автоматическая',[{field:'kufar.cars_autogearbox',choice:name}],'compound');
 add('transmission',name,'onliner','автоматическая');
}
for(const [name,base,flag]of [['Бензин (пропан-бутан)','бензин','gas'],['Бензин (метан)','бензин','gas'],['Бензин (гибрид)','бензин','hybrid'],['Дизель (гибрид)','дизель','hybrid']]){
 add('engine',name,'onliner',base,[{field:'onliner.'+flag,value:true}],'compound');
 add('engine',name,'abw',flag==='gas'?'газ':'гибрид');
}
