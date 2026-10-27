"use client";
import {categoryFields,cleanAttributes,fieldCatalog,fieldVerification} from '../lib/attributes';
import type {Listing} from '../lib/listing';
import {type CategoryOverrides} from '../lib/taxonomy';
import type {AttributeValues} from '../lib/field-rules';
const names:Record<string,string>={kufar:'Kufar',onliner:'Onlíner',flagma:'Flagma',av:'av.by',bamper:'Bamper',abw:'ABW',drom:'Дром'};
export function CategoryAttributes({listing,values={},overrides={},onChange}:{listing:Listing;values?:AttributeValues;overrides?:CategoryOverrides;onChange:(values:AttributeValues)=>void}) {
  const fields=categoryFields(listing,values,overrides);
  return <section className="panel category-attributes" aria-label="Характеристики категории">
    <h2>Дополнительные характеристики</h2>
    <p>Все поля необязательны в Автопосте. Заполненные значения сохранятся в карточке. Помощник переносит поддерживаемые характеристики в отдельные поля площадок.</p>
    {fields.length?<div className="fields-grid">{fields.map(field=><label key={field.key}>
      {field.label}
      {field.options.length?<select aria-label={field.label} value={values[field.key]||""} onChange={e=>onChange(cleanAttributes(listing,{...values,[field.key]:e.target.value},overrides))}>
        <option value="">Не указано</option>{field.options.map(([code,label])=><option key={code} value={code}>{label}</option>)}
      </select>:<input aria-label={field.label} value={values[field.key]||""} maxLength={300} onChange={e=>onChange(cleanAttributes(listing,{...values,[field.key]:e.target.value},overrides))} />}
      {field.required&&<small>Требуется на {names[field.platform||'kufar']}; доступность зависит от предыдущих полей</small>}
      {field.platform&&<small>Отдельное поле {names[field.platform]}</small>}
    </label>)}</div>:<p>Для этой категории дополнительные поля пока не подтверждены. Характеристики можно указать в описании.</p>}
    <details className="field-coverage"><summary>Что проверено по площадкам</summary>
      <p className="fine-print">Проверка справочников: {fieldCatalog.checkedAt}. Документация импорта и живая форма могут различаться. Зависимые поля появляются после выбора родительского значения.</p>
      <ul>{Object.entries(names).map(([id,name])=>{
        const check=fieldVerification(listing.taxonomyId,id,overrides);
        const labels:Record<string,string>={har_inspected:'Структура и последовательность формы проверены по записи браузера (новые и с пробегом). Публикация расширением ещё не проверена.',not_mapped:'Категория не сопоставлена.',documentation:'Поля из официальной документации; живая форма этой категории не проверена.',documentation_and_sample:'Справочник и состав формы этой категории проверены после входа; публикация не выполнялась.',form_inspected:id==='onliner'?'Форма раздела проверена после входа. Характеристики товара — в описании; обязательность при отправке не проверялась.':'Базовая форма запчастей проверена после входа. Все зависимые варианты деталей ещё не проверены.',blocked_vpn:'Проверка формы заблокирована из-за VPN.',form_not_verified:'Проверка формы после входа ещё не выполнена.'};
        return <li key={id}><b>{name}:</b> {check.source?<a href={check.source} target="_blank" rel="noreferrer">{labels[check.status]}</a>:labels[check.status]}</li>;
      })}</ul>
    </details>
  </section>;
}
