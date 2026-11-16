// Offline bootstrap only. Does not contact av.by or activate a production category.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const OUTPUT = path.join(ROOT, 'data/parsing/cars_used_sale');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const normalized = value => value.normalize('NFC').trim().toLocaleLowerCase('ru');
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const id = key => `av.${key}`;
const missingReason = 'Основа по историческому исследованию и видео. Нужны актуальный DOM, проверка установки/чтения значения и условий доступности; видеозапись не является тестом binding.';

export function choice(key, name, value = null, description = '') {
  // Unknown native IDs remain null. Label-based local IDs are not marketplace codes.
  return {id: id(`${key}.${value === null ? 'label-' + digest(name) : typeof value + '-' + encodeURIComponent(value)}`),
    name, description, type: 'choice', value, options: []};
}

export function build(history, video) {
  const fields = [], bindings = [], provenance = {};
  const extras = new Map(history.additional_fields.map(f => [f.formName, f]));
  const ignored = new Set(['salon_offer', 'mileage_compound_on_submission_form', 'price_compound_on_submission_form', 'phones']);
  const historicalTypes = {select: 'enum', int: 'integer', string: 'text', boolean: 'boolean', image_upload: 'files'};
  for (const [key, old] of Object.entries(history.fields)) {
    if (ignored.has(key)) continue;
    const type = key === 'year' ? 'integer' : key === 'options' ? 'multi_enum' : historicalTypes[old.fallbackType];
    if (!type) throw Error(`Unclassified field: ${key}`);
    const field = {id: id(key), name: old.label || 'Включить временный номер',
      description: 'Метаданные из исследования 2026-10-27; актуальная обязательность и условия требуют проверки.',
      type, options: [], required: null};
    provenance[field.id] = {historical_required: old.required, source: 'av-historical-recovery.json', video_candidate: video.dom_candidates[key] || null};
    if (type === 'enum' || type === 'multi_enum') {
      field.options_complete = false;
      let options = extras.get(key)?.options || [];
      if (key === 'condition_promotion') options = options.filter(([value]) => value === '2');
      field.options = options.map(([value, name]) => choice(key, name, value, 'Код и подпись из исторических данных 2026-10-27; текущая доступность не подтверждена.'));
      for (const name of video.flat_options[key] || []) {
        const matches = field.options.filter(c => normalized(c.name) === normalized(name));
        if (matches.length === 1) {
          matches[0].name = name;
          matches[0].description += ' Подпись также видна в видео 2026-11-13.';
        } else field.options.push(choice(key, name, null, 'Подпись видна в видео 2026-11-13; нативный код не прочитан.'));
      }
      for (const native of video.native_values_read_from_dom.filter(v => v.field === key)) {
        const matches = field.options.filter(c => c.name === native.name);
        if (matches.length !== 1) throw Error(`Ambiguous video value: ${key}/${native.name}`);
        // Keep the local ID stable when its previously unknown native value is recovered.
        matches[0].value = native.value;
        matches[0].description = `Нативный код прочитан в DOM на видео, ${native.timestamp_seconds} с. Тип значения — строка HTML input.`;
      }
    }
    if (type === 'files') field.file_role = 'product_image';
    fields.push(field);
    bindings.push({option_id: field.id, status: 'needs_review', reason: missingReason});
  }
  const get = key => fields.find(f => f.id === id(key));
  const binding = key => bindings.find(f => f.option_id === id(key));
  const treeNode = (key, name, value, level, children = [], complete = false) => ({
    ...choice(key, name, value, 'Неполная исследовательская основа; неизвестные коды не подменять локальными ID.'),
    level: id(level), options_complete: complete, childOptions: children
  });
  const models = video.catalog.models.map(name => treeNode(`model.kia`, name, null, 'model',
    (video.catalog.generations[name] || []).map(g => treeNode(`generation.kia.${digest(name)}`, g, null, 'generation', [], true))));
  get('brand').options = [treeNode('brand', video.catalog.brand, null, 'brand', models)];
  get('brand').description = 'Начальная ветвь Kia из видео. Другие марки ещё не собраны; это не полный каталог.';
  get('model').parent_option_id = id('brand');
  get('model').options = [];
  get('generation').parent_option_id = id('model');
  get('generation').options = [];
  get('generation').description = 'Все поколения должны накапливаться под моделью без годов. Сейчас у Rio только два наблюдённых поколения одного состояния формы. Выбор года на сайте влияет на доступность, но не определяет структуру каталога.';
  get('year').description = 'Отдельный год выпуска, integer. Не собирать массивы годов и диапазоны по маркам/моделям/поколениям. Нет выбранного значения или придуманного диапазона.';
  for (const region of get('place_region').options) {
    region.level = id('place_region');
    region.options_complete = false;
    region.childOptions = normalized(region.name) === normalized(video.geography.region)
      ? [treeNode(`place_city.${typeof region.value}-${region.value}`, video.geography.city, null, 'place_city', [], true)] : [];
  }
  get('place_city').parent_option_id = id('place_region');
  get('place_city').options = [];
  get('place_city').description = 'Варианты находятся в childOptions области. В скриншоте подтверждён только Брагин под Гомельской областью; код и полный список городов неизвестны.';
  get('options').options = Object.entries(video.equipment_sections).flatMap(([section, names]) => names.map(name =>
    choice('options', name, null, `Видео 2026-11-13, визуальный раздел «${section}». Нативный код не прочитан; раздел не является уровнем childOptions.`)));
  get('options').description = 'Плоский multi_enum комплектации. Все визуальные разделы объединены в options. Полнота и применимость к другим автомобилям не доказаны.';
  get('photo').validation = {max_items: video.file_constraints.photo.max_items, mime_types: video.file_constraints.photo.mime_types, max_file_size_bytes: null};
  get('photo').description = 'На видео: до 30 JPG/PNG, до 20 МБ на файл; точное число байтов лимита неизвестно. Отправка файла и приём сервером не проверены.';
  get('vin').validation = {min_length: 17, max_length: 17};
  get('vin').description = 'Текстовый код из 17 символов. Подсказка сообщает необязательность для старого транспорта; полное условие обязательности не проверено, required=null.';
  get('engine_capacity').description += ' Единица площадки — см³, не литры.';
  get('phone_number').description += ' Не хранить номер объявления в схеме. Несколько строк телефона должны сохраняться независимо; поведение при добавлении строки не проверено.';
  get('photo360').description = 'В видео показано предложение создавать фото 360 через приложение av.by; браузерный загрузчик не обнаружен.';
  binding('photo360').status = 'unsupported';
  binding('photo360').reason = 'В показанной веб-форме нет подтверждённого браузерного загрузчика фото 360; предлагается мобильное приложение.';
  binding('number_masking').status = 'unsupported';
  binding('number_masking').reason = 'Настройка временного номера остаётся пользователю; не относится к автоматическому заполнению характеристик автомобиля.';
  for (const [key, parents] of Object.entries({model: ['brand'], generation: ['model','year'], place_city: ['place_region'], price_amount: ['price_currency'], mileage: ['mileage_unit'], phone_number: ['phone_country']})) {
    binding(key).depends_on = parents.map(id);
  }
  const schema = [{id: 'cars_used_sale', name: 'Продажа легковых автомобилей с пробегом',
    description: 'AV.by. НЕПОЛНАЯ ОСНОВА по историческим данным и видео 2026-11-13. Контракт 2.2. Не подключать к production или финальному mapping до полного сбора и проверки.',
    categories: [], options: fields}];
  const result = {schema, binding: {category_id: 'cars_used_sale', platform: 'av', fields: bindings}, provenance};
  validate(result);
  return result;
}

export function validate({schema, binding}) {
  if (schema.length !== 1 || schema[0].id !== 'cars_used_sale') throw Error('Category mismatch');
  const fields = schema[0].options, ids = new Set(), fieldIds = new Set(fields.map(f => f.id));
  const next = {'av.brand': 'av.model', 'av.model': 'av.generation', 'av.place_region': 'av.place_city'};
  const treeLevels = new Set([...Object.keys(next), ...Object.values(next)]);
  function visit(option, level) {
    if (ids.has(option.id)) throw Error('Duplicate ID: ' + option.id);
    ids.add(option.id);
    if (!Array.isArray(option.options)) throw Error('Missing options');
    if (option.type === 'choice') {
      if (!Object.hasOwn(option, 'value') || option.options.length) throw Error('Invalid choice');
      if (level && option.level !== level) throw Error('Tree level mismatch');
    }
    if (Object.hasOwn(option, 'childOptions')) {
      if (option.type !== 'choice' || !treeLevels.has(option.level)) throw Error('Unexpected tree');
      if (typeof option.options_complete !== 'boolean') throw Error('Missing branch completeness');
      if (!next[option.level] && option.childOptions.length) throw Error('Children under a terminal node');
      option.childOptions.forEach(child => visit(child, next[option.level]));
    }
    option.options.forEach(child => visit(child, treeLevels.has(option.id) ? option.id : undefined));
  }
  fields.forEach(field => {
    visit(field);
    if (field.parent_option_id && (!fieldIds.has(field.parent_option_id) || field.options.length)) throw Error('Invalid parent/duplicate tree');
    if (['enum','multi_enum'].includes(field.type) && typeof field.options_complete !== 'boolean') throw Error('Missing enum completeness');
    if (field.id === 'av.year' && (field.type !== 'integer' || field.options.length || field.childOptions || field.validation)) throw Error('Years must not form a dictionary');
  });
  if (binding.fields.length !== fields.length || new Set(binding.fields.map(f => f.option_id)).size !== fields.length) throw Error('Binding coverage');
  for (const b of binding.fields) {
    if (!fieldIds.has(b.option_id) || !b.reason || !['needs_review','unsupported'].includes(b.status)) throw Error('Unverified binding marked ready');
    if ((b.depends_on || []).some(p => !fieldIds.has(p))) throw Error('Missing dependency');
  }
  return {fields: fields.length, choices: ids.size - fields.length, needs_review: binding.fields.filter(b => b.status === 'needs_review').length, unsupported: binding.fields.filter(b => b.status === 'unsupported').length};
}

export function generate(output = OUTPUT) {
  const history = read(path.join(OUTPUT, 'evidence/av-historical-recovery.json'));
  const video = read(path.join(OUTPUT, 'evidence/av-video-observations.json'));
  const result = build(history, video);
  fs.mkdirSync(path.join(output, 'evidence'), {recursive: true});
  for (const [file, object] of Object.entries({'cars_used_sale_av.json': result.schema, 'binding_cars_used_sale_av.json': result.binding, 'evidence/av-seed-provenance.json': result.provenance})) {
    fs.writeFileSync(path.join(output, file), JSON.stringify(object, null, 2) + '\n');
  }
  return validate(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Seed writes go to an isolated directory by default, preserving any later enriched files.
  const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'work/av-seed');
  console.log(JSON.stringify({output: destination, ...generate(destination)}, null, 2));
}
