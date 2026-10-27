import {validateListing, type Listing} from './listing.ts';
import {getPlatforms, platformValidation, type Job} from './platforms.ts';
import {categoryMapping} from './taxonomy.ts';
import {fieldCatalog, fieldVerification} from './attributes.ts';
import {fieldRules, baseFieldKeys} from './field-rules.ts';
import type {AdRecord, AdSummary} from './workspace.ts';

export function existingJob(job:Job) {
  return !!job.url || !['draft','ready','cancelled','unsupported'].includes(job.status);
}
export function availablePlatforms(record:AdRecord|AdSummary) {
  return record.selected.filter(id=>!record.jobs.some(j=>j.platformId===id && existingJob(j)));
}
export function readiness(record:AdRecord|AdSummary, connected:boolean) {
  const listing=record.listing;
  const common=[...validateListing(listing),...(!record.categoryConfirmed?['Подтвердите категорию']:[]),
    ...(record.sold||listing.availability==='Нет в наличии'||listing.quantity==='0'?['Товар продан или отсутствует в наличии']:[]),
    ...(!record.prepared?['Подготовьте карточку']:[]),...((('photos' in record?record.photos.length:record.photoCount)===0)?['Добавьте фотографии']:[])];
  return getPlatforms(listing.category,listing.taxonomyId).filter(p=>record.selected.includes(p.id)).map(platform=>{
    const mapping=categoryMapping(listing.taxonomyId,platform.canonicalId,record.categoryOverrides);
    const job=record.jobs.find(j=>j.platformId===platform.id);
    const blockers=[...common,...platformValidation(listing,[platform.id],record.categoryOverrides),...(!connected?['Подключите расширение']:[])];
    const missing=platform.canonicalId==='kufar'?fieldRules(fieldCatalog,mapping,record.attributes||{},listing)
      .filter(f=>f.required && !listing[baseFieldKeys[f.key] as keyof Listing] && !record.attributes?.[f.key] && !mapping?.attributes?.some(a=>a.key===f.key))
      .map(f=>f.label):[];
    const verification=fieldVerification(listing.taxonomyId,platform.canonicalId,record.categoryOverrides);
    const notes=[...(missing.length?['Площадка может запросить: '+missing.join(', ')]:[]),
      ...(!['form_inspected','documentation_and_sample'].includes(verification.status)?['Живая форма категории проверена не полностью. Дополнительные поля могут появиться на площадке.']:[]),
      'Вход в аккаунт и ограничения площадки проверяются при открытии формы.',
      ...(!['kufar','onliner'].includes(platform.canonicalId)||platform.canonicalId==='onliner'&&listing.category==='cars'?['Финальная отправка на этой площадке — с вашим участием.']:[])];
    return {platform,job,blockers:[...new Set(blockers)],notes,existing:!!job&&existingJob(job)};
  });
}
export function queueGroup(job:Job):'attention'|'running'|'waiting'|'done' {
  if(job.remoteStatus && ['rejected','action_required'].includes(job.remoteStatus.state))return 'attention';
  if(job.url || ['submitted','published','inactive','cancelled'].includes(job.status))return 'done';
  if(['opening','auto_checking','submitting'].includes(job.status))return 'running';
  if(['draft','ready','queued'].includes(job.status))return 'waiting';
  return 'attention';
}
