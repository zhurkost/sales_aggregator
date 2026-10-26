"""Extract category fields from the official Kufar import specification.
Install beautifulsoup4; pass the downloaded revision 5 HTML as argv[1].
This is documentation coverage, not a claim of logged-in form verification.
"""
import json, pathlib, re, sys, hashlib
from bs4 import BeautifulSoup

source = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'docs/sources/kufar-current.html')
raw = source.read_bytes()
soup = BeautifulSoup(raw.decode('utf8'), 'html.parser')
categories = {}
unparsed = []
for box in soup.select('[id$="sell_type-sell-root"]'):
    match = re.fullmatch(r'cat-(\d+)-(\d+)-sell_type-sell-root',box['id'])
    if not match: continue
    parent, category = match.groups()
    fields = []
    for anchor in box.select('.accordion-heading a'):
        code = anchor.find('code')
        if not code: continue
        key = code.get_text(strip=True)
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,79}', key): continue
        label = anchor.get_text(' ',strip=True)[len(key):].strip().split('=>')[0].strip()
        # Some conditional hrefs omit the parent category while body IDs include it.
        group = anchor.find_parent('div',class_='accordion-group')
        content = group.find('div',class_='accordion-body',recursive=False)
        if not content: unparsed.append(anchor.get('href')); continue
        options = []
        for paragraph in content.select('p'):
            option_code = paragraph.find('code')
            if not option_code: continue
            value = option_code.get_text(strip=True)
            title = paragraph.get_text(' ',strip=True)[len(value):].strip()
            if value and title: options.append([value,title])
        field = {'key':key,'label':label,'required':'required' in code.get('class',[]),'options':options}
        condition = anchor.get_text(' ',strip=True).split('=>',1)
        if len(condition)>1:
            field['depends']=[]
            for clause in condition[1].split('&'):
                rule = re.fullmatch(r'\s*([a-z][a-z0-9_]*)=(\$in\[[^\]]+\]|\$any|[\w.-]+)\s*',clause)
                if not rule: unparsed.append(anchor.get_text(' ',strip=True)); continue
                dep, value = rule.groups()
                field['depends'].append({'key':dep, 'values':None if value=='$any' else value[4:-1].split(',') if value.startswith('$in[') else [value]})
        field['anchor'] = content['id']
        if field not in fields: fields.append(field)
    categories[category] = fields

if unparsed: raise ValueError('Unparsed field rules: '+repr(unparsed[:8]))
taxonomy=json.loads(pathlib.Path('data/taxonomy.json').read_text('utf8'))
audit=json.loads(pathlib.Path('data/form-audit.json').read_text('utf8'))
coverage={}
extra={}
def field(key,label,platform,name,options=None,description=True):
    return {'key':key,'label':label,'platform':platform,'formName':name,'required':False,'options':options or [],'anchor':'','description':description}
for node in taxonomy['nodes']:
    coverage[node['id']]={}
    for platform in ['kufar','onliner','flagma','av','bamper','abw','drom']:
        mapping=node['mappings'].get(platform)
        coverage[node['id']][platform]=('not_mapped' if not mapping else 'documentation' if platform=='kufar' and mapping['id'] in categories else 'form_not_verified')
        if mapping and mapping['id'] in audit.get(platform,{}).get('categoryIds',[]): coverage[node['id']][platform]='form_inspected'
        if mapping and audit.get(platform,{}).get('status')=='blocked_vpn': coverage[node['id']][platform]='blocked_vpn'
    fields=[]
    if node['mappings'].get('onliner',{}).get('id') in audit['onliner']['categoryIds']:
        fields.append(field('onliner_short_description','Краткое описание для Onlíner','onliner','topic_desc',description=False))
    if node['mappings'].get('bamper',{}).get('id')=='parts':
        fields.extend([field('bamper_modification','Модификация автомобиля','bamper','VERSIA'),field('bamper_engine_code','Код / тип двигателя','bamper','ENGINE_MODEL_ID'),field('bamper_vin','VIN автомобиля-донора','bamper','VIN'),field('bamper_stock_code','Складской артикул','bamper','EXT_ID'),field('bamper_discount','Скидка, % (Bamper)','bamper','DISCOUNT',description=False)])
    if fields: extra[node['id']]=fields
output={'version':'2026-10-27.1','source':'https://import-docs.kufar.by/import_documentation_revision_5.html','sourceSha256':hashlib.sha256(raw).hexdigest(),'checkedAt':'2026-10-27','kufar':categories,'extra':extra,'coverage':coverage,'audit':audit}
pathlib.Path('data/category-fields.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf8')
print('Field documentation:',len(categories),'Kufar categories;',sum(len(f) for f in categories.values()),'field rules;',len(coverage),'Autopost categories audited across 7 platforms')
