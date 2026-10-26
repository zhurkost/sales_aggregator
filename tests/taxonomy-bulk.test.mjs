import test from 'node:test';
import assert from 'node:assert/strict';
import {categories,taxonomy,categoryMapping,mappingOptions,sanitizeCategoryOverrides,sanitizeCandidates,suggestCategories,categoryById} from '../lib/taxonomy.ts';
import {parseDelimited,normalizeImport,guessColumns,csvExport,flagmaRows,matchingPhotos,flagmaXlsx,readImport} from '../lib/bulk.ts';
import {safePublicationUrl,getPlatforms} from '../lib/platforms.ts';
test('taxonomy identifiers are unique; unknown AI categories never reach the flow',()=>{
 assert.equal(new Set(categories.map(c=>c.id)).size,categories.length);assert.ok(categories.length>300);
 assert.deepEqual(sanitizeCandidates([{id:'made.up',confidence:1}]),[]);
 assert.equal(sanitizeCandidates([{id:'auto.parts.optics',confidence:200},{id:'auto.parts.optics'}]).length,1);
 assert.equal(suggestCategories('Продам фару для Volkswagen Passat, OEM 000123')[0].id,'auto.parts.optics');
 assert.equal(categoryById('auto.cars').mappings.kufar.id,'2010');
 assert.equal(getPlatforms('general','goods.17010').length,3);
});

test('one GPU category routes to Kufar, Onliner and Flagma without marketplace-specific suggestions',()=>{
 assert.deepEqual(suggestCategories('видеокарты, 570').map(c=>c.id),['computers.gpu']);
 assert.equal(categoryById('onliner.286').id,'computers.gpu');
 assert.deepEqual(sanitizeCandidates([{id:'goods.16010'},{id:'onliner.286'},{id:'computers.gpu'}]).map(c=>c.id),['computers.gpu']);
 const gpu=categoryById('computers.gpu');
 assert.equal(gpu.mappings.kufar.id,'16010');
 assert.deepEqual(gpu.mappings.kufar.attributes,[{key:'computers_component_type',value:'11',label:'Видеокарты'}]);
 assert.equal(gpu.mappings.onliner.id,'286');assert.equal(gpu.mappings.flagma.id,'Видеокарты');
 assert.equal(getPlatforms('general','onliner.286').length,3);
 assert.equal(categories.some(c=>c.id.startsWith('onliner.')||c.parent.includes('Onlíner')),false);
 for(const section of taxonomy.directories.onliner)assert.ok(categoryById('onliner.'+section.id),section.name);
 for(const c of categories)for(const [platform,m]of Object.entries(c.mappings))assert.ok(mappingOptions(platform).some(o=>o.optionId===m.optionId),c.id+' / '+platform);
 assert.equal(mappingOptions('flagma').length,8881);
 // Known past mistakes must never silently reappear when importing directories.
 for(const [id,forum]of Object.entries({'goods.16030':'185','goods.16040':'63','goods.12050':'554','goods.21070':'1045','goods.21040':'1051'}))assert.equal(categoryById(id).mappings.onliner.id,forum);
});

test('marketplace correction changes only that route and uses allowlisted options',()=>{
 const overrides=sanitizeCategoryOverrides({onliner:'17',kufar:'unknown',evil:'286',flagma:{id:'made-up'}});
 assert.deepEqual(overrides,{onliner:'17'});
 assert.equal(categoryMapping('computers.gpu','onliner',overrides).id,'17');
 assert.equal(categoryMapping('computers.gpu','kufar',overrides).attributes[0].value,'11');
 const {rows,errors}=flagmaRows([{id:'gpu',listing:{title:'Видеокарта RX 570',description:'Рабочая видеокарта',taxonomyId:'computers.gpu',currency:'BYN',price:'150'}}],{});
 assert.deepEqual(errors,[]);assert.equal(rows[0]['Конечный подраздел'],'Видеокарты');
});
test('CSV accepts quoted delimiters, embedded newlines, BOM and escaped quotes',()=>{
 assert.deepEqual(parseDelimited('\ufeffНазвание;Описание;Артикул\r\nФара;"Есть; царапина\nи ""скол""";000123-AB'),[['Название','Описание','Артикул'],['Фара','Есть; царапина\nи "скол"','000123-AB']]);
 assert.throws(()=>parseDelimited('title,description\na,"unfinished'),/кавычки/);
});
test('bulk preserves OEM zeroes, flags duplicates, does not claim inferred category is confirmed',()=>{
 const rows=[{Название:'Фара',Описание:'Фара левая, есть царапина',Артикул:'000123-AB',Цена:'450',Валюта:'BYN'},{Название:'Фара',Описание:'Фара левая, есть царапина',Артикул:'000123-AB',Цена:'450',Валюта:'BYN'}];const table={headers:Object.keys(rows[0]),rows};
 const preview=normalizeImport(table,guessColumns(table.headers));assert.equal(preview[0].record.listing.partNumber,'000123-AB');assert.equal(preview[0].record.categoryConfirmed,false);assert.equal(preview[1].duplicate,true);
 const confirmed=normalizeImport(table,guessColumns(table.headers),'auto.parts.optics');assert.equal(confirmed[0].record.categoryConfirmed,true);
 const record=confirmed[0].record;record.listing.title='=HYPERLINK("evil")';assert.match(csvExport([record]),/'=HYPERLINK/);
 assert.ok(flagmaRows([record],{}).errors.length);record.listing.title='Фара';record.listing.description='Связаться: +375291234567';assert.ok(flagmaRows([record],{[record.id]:'Запчасти'}).errors.some(e=>e.includes('контакты')));
});
test('publication links reject credentials, foreign domains and active content',()=>{
 for(const u of ['javascript:alert(1)','https://www.kufar.by.evil.invalid/','https://user:secret@www.kufar.by/','http://www.kufar.by/'])assert.equal(safePublicationUrl('kufar-parts',u),'');
 assert.equal(safePublicationUrl('onliner-parts','https://baraholka.onliner.by/viewtopic.php?t=123'),'https://baraholka.onliner.by/viewtopic.php?t=123');
});
test('bulk photos match explicit references or exact external ID, without adjacent IDs',()=>{
 const files=['A001_1.jpg','A001-2.png','A0010_1.jpg','unrelated.jpg'].map(name=>({name}));
 const record={externalId:'A001'};
 assert.deepEqual(matchingPhotos(record,files),files.slice(0,2));
 record.photoRefs=['https://photos.example/A001-2.png?size=big'];
 assert.deepEqual(matchingPhotos(record,files),[files[1]]);
 assert.deepEqual(matchingPhotos({},files),[]);
});
test('real XLSX import preserves string OEM, ignores formulas, and Flagma workbook opens',async()=>{
 const {default:Excel}=await import('exceljs');const book=new Excel.Workbook();const sheet=book.addWorksheet('Export');
 sheet.addRow(['Название','Артикул','Описание']);sheet.addRow(['Фара','000123-AB','Есть царапина']);sheet.addRow(['Другая деталь','000002',{formula:'1+1',result:2}]);
 const bytes=await book.xlsx.writeBuffer();const table=await readImport(new File([bytes],'input.xlsx'));
 assert.equal(table.rows[0]['Артикул'],'000123-AB');assert.equal(table.rows[1]['Описание'],'');
 const record=normalizeImport(table,guessColumns(table.headers),'auto.parts.optics')[0].record;
 record.photoRefs=['https://images.example/photo.jpg'];
 const output=await flagmaXlsx([record],{[record.id]:'Фары автомобильные'});
 const exported=await readImport(new File([output],'flagma.xlsx'));
 assert.equal(exported.rows[0]['Название'],'Фара');assert.equal(exported.rows[0]['Неактивное'],'да');assert.equal(exported.rows[0]['Фото товара'],record.photoRefs[0]);
});
