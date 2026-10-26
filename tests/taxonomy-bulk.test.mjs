import test from 'node:test';
import assert from 'node:assert/strict';
import {categories,sanitizeCandidates,suggestCategories,categoryById} from '../lib/taxonomy.ts';
import {parseDelimited,normalizeImport,guessColumns,csvExport,flagmaRows,matchingPhotos,flagmaXlsx,readImport} from '../lib/bulk.ts';
import {safePublicationUrl,getPlatforms} from '../lib/platforms.ts';
test('taxonomy identifiers are unique; unknown AI categories never reach the flow',()=>{
 assert.equal(new Set(categories.map(c=>c.id)).size,categories.length);assert.ok(categories.length>350);
 assert.deepEqual(sanitizeCandidates([{id:'made.up',confidence:1}]),[]);
 assert.equal(sanitizeCandidates([{id:'auto.parts.optics',confidence:200},{id:'auto.parts.optics'}]).length,1);
 assert.equal(suggestCategories('Продам фару для Volkswagen Passat, OEM 000123')[0].id,'auto.parts.optics');
 assert.equal(categoryById('auto.cars').mappings.kufar.id,'2010');
 assert.equal(getPlatforms('general','goods.17010').length,3);
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
