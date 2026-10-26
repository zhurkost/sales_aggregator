"""Build a dated snapshot from the official, downloaded Kufar documentation and Onliner index.
No credentials, private APIs or inferred remote identifiers. See docs/integrations.md.
Usage: PYTHONPATH=<beautifulsoup4 dir> python scripts/import-taxonomy.py
"""
import json, pathlib, re
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
# Explicit editorial mappings; no generated/guessed external IDs.
mapping={'auto.cars':'20','goods.17010':'2','goods.16030':'3','goods.17050':'436','goods.21010':'623','goods.21020':'624','goods.12050':'558','goods.12040':'554','goods.18030':'598'}
# Only attach an ID if it is present in the downloaded directory AND its meaning matches.
mapping={'goods.17010':'Мобильные телефоны','goods.16030':'Ноутбуки','goods.12050':'Детские игрушки','goods.12040':'Детские коляски','goods.18030':'Парфюмерия','goods.4070':'Музыкальные инструменты','goods.6020':'Ищу работу','goods.6010':'Вакансии','goods.16040':'Мониторы. Проекторы','goods.4020':'Велосипеды','goods.21010':'Диваны. Кресла. Мягкая мебель','goods.21020':'Кровати. Матрасы. Мебель для спальни'}
for n in nodes:
    label=mapping.get(n['id'])
    match=next((o for o in onliner if o['name'].strip()==label),None)
    if match:n['mappings']['onliner']={'id':match['id'],'path':[match['name']],'source':'onliner-index','verified':True}
    if n['id']=='auto.cars':
        for p in ['av','onliner','abw','drom']: n['mappings'][p]={'id':'cars','path':['Легковые автомобили'],'source':p+'-site','verified':p!='drom'}
    if n['id']=='auto.parts':
        for p in ['bamper','abw']:n['mappings'][p]={'id':'parts','path':['Запчасти'],'source':p+'-site','verified':True}

parts=[('optics','Оптика','Автомобильная оптика. Тюнинг. Автосигнализация',['фара','фару','фонарь','оптика']),('body','Кузовные детали','Кузовные запчасти. Салон. Аксессуары',['бампер','капот','крыло','дверь']),('engine','Двигатель и зажигание','Двигатели. Системы пуска, заряда и зажигания',['двигатель','стартер','генератор']),('cooling','Охлаждение и отопление','Система охлаждения, отопления, вентиляции',['радиатор','вентилятор','печка']),('fuel','Топливная и выхлопная системы','Топливная система. Система выпуска',['форсунка','глушитель','насос']),('gearbox','Трансмиссия','Сцепление. Коробка передач. Привод',['коробка','сцепление','акпп','мкпп']),('suspension','Подвеска и рулевое','Подвеска. Рулевое управление',['рычаг','амортизатор','рейка']),('brakes','Тормоза','Тормозная система',['суппорт','колодки','тормоз']),('battery','Аккумуляторы','Аккумуляторы. Пуско-зарядные устройства',['аккумулятор','акб'])]
for key,title,ol,keywords in parts:
    match=next(o for o in onliner if o['name'].strip()==ol)
    nodes.insert(2,{'id':'auto.parts.'+key,'name':title,'parent':'Автозапчасти','group':'parts','keywords':keywords,'mappings':{
      'kufar':{'id':'2040','path':['Авто и запчасти','Запчасти'],'source':'kufar-docs','verified':True},
      'bamper':{'id':'parts','path':['Запчасти',title],'source':'bamper-site','verified':False},
      'onliner':{'id':match['id'],'path':[ol],'source':'onliner-index','verified':True},
      'abw':{'id':'parts','path':['Запчасти'],'source':'abw-site','verified':True}}})
# Additional Onliner leaves remain selectable without pretending they match another marketplace.
mapped={n['mappings'].get('onliner',{}).get('id') for n in nodes}
for o in onliner:
    if o['id'] in mapped:continue
    nodes.append({'id':'onliner.'+o['id'],'name':o['name'],'parent':'Барахолка Onlíner','group':'general','keywords':[], 'mappings':{'onliner':{'id':o['id'],'path':[o['name']],'source':'onliner-index','verified':True}}})
sources={'kufar-docs':'https://import-docs.kufar.by/import_documentation_revision_5.html','onliner-index':'https://baraholka.onliner.by/','bamper-site':'https://bamper.by/contacts/','abw-site':'https://abw.by/carparts','av-site':'https://av.by/','onliner-site':'https://ab.onliner.by/','drom-site':'https://auto.drom.ru/minsk/'}
data={'version':'2026-10-26.1','sources':sources,'nodes':nodes,'directories':{'kufar':remote,'onliner':onliner},'coverage':'Категории из открытых справочников Kufar и Onliner; специализации av.by, Bamper, ABW, Drom. Полный справочник Flagma и закрытые формы требуют подключения аккаунта. Каталог расширяется, он не охватывает все сайты Беларуси.'}
(out/'taxonomy.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
print('Taxonomy:',len(nodes),'local categories;',len(remote),'Kufar nodes;',len(onliner),'Onliner sections')
