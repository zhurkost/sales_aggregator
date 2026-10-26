"""Build a dated snapshot from the official, downloaded Kufar documentation and Onliner index.
No credentials, private APIs or inferred remote identifiers. See docs/integrations.md.
Usage: PYTHONPATH=<beautifulsoup4 dir> python scripts/import-taxonomy.py
"""
import json, pathlib, re, hashlib
from collections import defaultdict
from bs4 import BeautifulSoup

source=pathlib.Path('docs/sources')
out=pathlib.Path('data'); out.mkdir(exist_ok=True)
soup=BeautifulSoup((source/'kufar.html').read_text(encoding='utf8'),'html.parser')
roots={}; nodes=[]; remote=[]; seen=set()
for a in soup.select('a[href]'):
    m=re.fullmatch(r'#category-(\d+)(?:-subcategory-(\d+))?',a['href'])
    if not m: continue
    parent,child=m.groups(); rid=child or parent
    name=re.sub(r'^\d+\s*','',a.get_text(' ',strip=True)).strip()
    if 'label ru is missing' in name: continue
    remote.append({'id':rid,'parentId':parent if child else None,'name':name})
    if not child: roots[parent]=name; continue
    if rid in seen: continue
    seen.add(rid)
    cid='auto.cars' if rid=='2010' else 'auto.parts' if rid=='2040' else 'goods.'+rid
    group='cars' if rid=='2010' else 'parts' if rid=='2040' else 'general'
    path=[roots[parent],name]
    nodes.append({'id':cid,'name':name,'parent':roots[parent],'group':group,'keywords':[],
      'mappings':{'kufar':{'id':rid,'path':path,'source':'kufar-docs','verified':True}}})

onliner=json.loads((source/'onliner-categories.json').read_text(encoding='utf8'))
# Autopost owns the taxonomy. Marketplace directories are routing metadata only.
for n in nodes:
    if n['id']=='auto.cars':
        for p in ['av','onliner','abw','drom']: n['mappings'][p]={'id':'cars','path':['Легковые автомобили'],'source':p+'-site','verified':p!='drom'}
    if n['id']=='auto.parts':
        for p in ['bamper','abw']: n['mappings'][p]={'id':'parts','path':['Запчасти'],'source':p+'-site','verified':True}

parts=[('optics','Оптика','Автомобильная оптика. Тюнинг. Автосигнализация',['фара','фару','фонарь','оптика']),('body','Кузовные детали','Кузовные запчасти. Салон. Аксессуары',['бампер','капот','крыло','дверь']),('engine','Двигатель и зажигание','Двигатели. Системы пуска, заряда и зажигания',['двигатель','стартер','генератор']),('cooling','Охлаждение и отопление','Система охлаждения, отопления, вентиляции',['радиатор','вентилятор','печка']),('fuel','Топливная и выхлопная системы','Топливная система. Система выпуска',['форсунка','глушитель','насос']),('gearbox','Трансмиссия','Сцепление. Коробка передач. Привод',['коробка','сцепление','акпп','мкпп']),('suspension','Подвеска и рулевое','Подвеска. Рулевое управление',['рычаг','амортизатор','рейка']),('brakes','Тормоза','Тормозная система',['суппорт','колодки','тормоз']),('battery','Аккумуляторы','Аккумуляторы. Пуско-зарядные устройства',['аккумулятор','акб'])]
for key,title,ol,keywords in parts:
    match=next(o for o in onliner if o['name'].strip()==ol)
    nodes.insert(2,{'id':'auto.parts.'+key,'name':title,'parent':'Автозапчасти','group':'parts','keywords':keywords,'mappings':{
      'kufar':{'id':'2040','path':['Авто и запчасти','Запчасти'],'source':'kufar-docs','verified':True},
      'bamper':{'id':'parts','path':['Запчасти',title],'source':'bamper-site','verified':False},
      'onliner':{'id':match['id'],'path':[ol],'source':'onliner-index','verified':True},
      'abw':{'id':'parts','path':['Запчасти'],'source':'abw-site','verified':True}}})
crosswalk=json.loads((out/'category-crosswalk.json').read_text(encoding='utf8'))
by_id={n['id']:n for n in nodes}
ol={o['id']:o for o in onliner}
assert set(crosswalk['relations'])==set(ol), 'Every public Onliner section needs an explicit reviewed relation'
aliases={}
def local_id(rid): return 'auto.cars' if rid=='2010' else 'auto.parts' if rid=='2040' else 'goods.'+rid
def onliner_mapping(oid):
    return {'id':oid,'path':[ol[oid]['name']],'source':'onliner-index','verified':True}
# Existing car-parts specializations have stable IDs and remain backward compatible.
for n in nodes:
    if 'onliner' in n['mappings'] and n['mappings']['onliner']['id'] in ol:
        aliases['onliner.'+n['mappings']['onliner']['id']]=n['id']
for oid,targets in crosswalk['relations'].items():
    if 'onliner.'+oid in aliases: continue
    if oid=='21': aliases['onliner.21']='auto.cars'; continue
    if oid in ['285','1676','286','184','181','17']: continue
    if not targets:
        entry=crosswalk['standalone'][oid]
        n={**entry,'group':'general','keywords':[],'mappings':{'onliner':onliner_mapping(oid)}}
        nodes.append(n); by_id[n['id']]=n; aliases['onliner.'+oid]=n['id']; continue
    bases=[by_id[local_id(rid)] for rid in targets]
    if oid in crosswalk['refine']:
        base=bases[0]
        n={'id':base['id']+'.section-'+oid,'name':ol[oid]['name'],'parent':base['parent']+' / '+base['name'],
           'parentId':base['id'],'group':base['group'],'keywords':[],
           'mappings':{'kufar':{**base['mappings']['kufar'],'match':'broader'},'onliner':onliner_mapping(oid)}}
        if oid=='406':
            n['group']='general'; n['parent']='Мототехника / Запчасти'
            box=soup.find(id='cat-2000-2040-sell_type-sell-spares_type')
            label=next(p.get_text(' ',strip=True).split(' ',1)[1] for p in box.select('p') if p.code and p.code.get_text(strip=True)=='6')
            n['mappings']['kufar']['attributes']=[{'key':'spares_type','value':'6','label':label}]
        nodes.append(n); by_id[n['id']]=n; aliases['onliner.'+oid]=n['id']
        # Secondary targets are different products contained in the same broad forum.
        for base in bases[1:]: base['mappings'].setdefault('onliner',onliner_mapping(oid))
    else:
        for base in bases:
            base['mappings'].setdefault('onliner',{**onliner_mapping(oid),'match':'broader'})
        aliases['onliner.'+oid]=bases[0]['id']
# Kufar has a category plus a mandatory component-type parameter, not a GPU category ID.
component_box=soup.find(id='cat-16000-16010-sell_type-sell-computers_component_type')
component_labels={p.code.get_text(strip=True):p.get_text(' ',strip=True).split(' ',1)[1] for p in component_box.select('p') if p.code}
for code,(slug,oid,keywords) in crosswalk['components'].items():
    label=component_labels[code]
    n={'id':'computers.'+slug,'name':label,'parent':'Компьютерная техника / Комплектующие','parentId':'goods.16010','group':'general','keywords':keywords,
       'mappings':{'kufar':{**by_id['goods.16010']['mappings']['kufar'],'attributes':[{'key':'computers_component_type','value':code,'label':label}]},'onliner':onliner_mapping(oid)}}
    nodes.append(n);by_id[n['id']]=n;aliases.setdefault('onliner.'+oid,n['id'])
by_id['goods.16010']['mappings']['onliner']=onliner_mapping('17')
by_id['goods.16010']['name']='Компьютерные комплектующие — тип не определён'
by_id['goods.16010']['fallback']=True
# These forum sections contain products rather than marketplace-specific primary categories.
assert all('onliner.'+oid in aliases for oid in ol)
assert len({n['id'] for n in nodes})==len(nodes)
# Flagma publishes terminal names, not numeric API category IDs, in its XLSX catalog.
flagma=json.loads((out/'flagma-directory.json').read_text(encoding='utf8'))
flagma_options={}; flagma_names=defaultdict(list)
for path in flagma['paths']:
    key=hashlib.sha256('/'.join(path).encode()).hexdigest()[:16]
    m={'id':path[-1],'optionId':key,'path':path,'source':'flagma-directory','verified':True}
    assert key not in flagma_options
    flagma_options[key]=m; flagma_names[path[-1].casefold()].append(m)
for n in nodes:
    name=crosswalk['flagma'].get(n['id'],n['name'])
    matches=flagma_names[name.casefold()]
    if len(matches)==1: n['mappings']['flagma']=matches[0]
    elif n['id'] in crosswalk['flagma']: raise ValueError('Ambiguous Flagma mapping: '+name)
# Every remote leaf is available for an explicit per-marketplace correction.
options={'kufar':{},'onliner':{},'flagma':flagma_options}
for n in nodes:
    for platform,m in n['mappings'].items():
        key=m.get('optionId') or m['id']+''.join(':'+a['key']+':'+a['value'] for a in m.get('attributes',[]))
        m['optionId']=key
        options.setdefault(platform,{}).setdefault(key,m)
for oid in ol:
    options['onliner'].setdefault(oid,{**onliner_mapping(oid),'optionId':oid})
sources={'flagma-directory':flagma['source'],'kufar-docs':'https://import-docs.kufar.by/import_documentation_revision_5.html','onliner-index':'https://baraholka.onliner.by/','bamper-site':'https://bamper.by/contacts/','abw-site':'https://abw.by/carparts','av-site':'https://av.by/','onliner-site':'https://ab.onliner.by/','drom-site':'https://auto.drom.ru/minsk/'}
data={'version':'2026-10-27.1','aliases':aliases,'options':options,'sources':sources,'nodes':nodes,'directories':{'kufar':remote,'onliner':onliner},'coverage':'Единый справочник Автопоста с соответствиями всем разделам открытых каталогов Kufar и Onliner; специализации av.by, Bamper, ABW, Drom. Часть соответствий ведёт в более общий раздел и требует характеристик товара. Flagma: полный публичный справочник из 8881 конечного подраздела, точные совпадения связаны автоматически. Неподтверждённые соответствия выбираются отдельно. Закрытые формы требуют входа. Каталог расширяется, он не охватывает все сайты Беларуси.'}
(out/'taxonomy.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
print('Taxonomy:',len(nodes),'local categories;',len(remote),'Kufar nodes;',len(onliner),'Onliner sections')
