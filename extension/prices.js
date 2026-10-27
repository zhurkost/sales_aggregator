/* Public search pages only. No hidden tabs, credentials, private APIs or challenge bypasses. */
(function (root) {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const normalize = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'');
  const plain = value => String(value || '').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(n.replace(/^x/i,''),/^x/i.test(n)?16:10)))).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[n]).replace(/\s+/g,' ').trim();
  function validate(value) {
    if (!value || typeof value.query !== 'string' || value.query.length < 3 || value.query.length > 120 || /https?:|@|\+375|\b\d{9,}\b|[<>\u0000-\u001f]/i.test(value.query)) throw new Error('Сначала уточните товар и поисковый запрос.');
    if (!Array.isArray(value.terms) || !value.terms.length || value.terms.length > 6 || value.terms.some(t => typeof t !== 'string' || !normalize(t) || t.length > 50)) throw new Error('Не удалось определить признаки товара.');
    const recipe = root.AutopostCore.validateRecipe(value.recipe);
    return {query:value.query.trim(),terms:value.terms, taxonomyId:recipe.taxonomyId,recipe,kind:value.kind === 'service' ? 'service' : 'product',condition:['Новая','Б/у','На восстановление'].includes(value.condition)?value.condition:''};
  }
  function matches(title, criteria) {
    const text = String(title).toLowerCase().replace(/ё/g,'е');
    if (!criteria.terms.every(term => {
      // Do not compare RX 5700 with RX 570; spaces and punctuation may vary.
      const needle = normalize(term);
      const pattern = [...needle].join('[\\s._/-]*') + (/\d$/.test(needle)?'(?!\\d)':'');
      return !!needle && new RegExp(pattern,'u').test(text);
    })) return false;
    if (/куплю|скупка|покупаем|обменяю/i.test(title)) return false;
    if (criteria.kind === 'product' && criteria.condition !== 'На восстановление' && /неисправн|нерабоч|на запчасти|ремонт\s/i.test(title)) return false;
    if(criteria.taxonomyId==='computers.gpu' && /радиатор|вентилятор|кулер|термопроклад/i.test(title))return false;
    return true;
  }
  function parseKufar(html) {
    const json = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!json) throw new Error('Структура поиска Kufar изменилась. Откройте выдачу для проверки.');
    const listing = JSON.parse(json)?.props?.initialState?.listing;
    if (!listing || !Array.isArray(listing.ads) || !/^\d+$/.test(String(listing.total)) || listing.isNetworkError || listing.error) throw new Error('Kufar не вернул поисковую выдачу.');
    const offers = listing.ads.slice(0,60).filter(ad => ad.type === 'sell').map(ad => {
      const parameters = ad.ad_parameters || [];
      const originalUSD = ad.currency === 'USD';
      const amount = ['USD','BYR','BYN'].includes(ad.currency) ? Number(originalUSD ? ad.price_usd : ad.price_byn) / 100 : null;
      const condition = parameters.find(p => p.p === 'condition')?.vl || '';
      return {title:String(ad.subject || '').slice(0,200),url:/^\d+$/.test(String(ad.ad_id))?`https://www.kufar.by/item/${ad.ad_id}`:'',price:amount,currency:originalUSD?'USD':'BYN',condition:/нов/i.test(condition)?'Новая':/б\/у/i.test(condition)?'Б/у':'',categoryId:String(ad.category || '')};
    });
    return {total:Number(listing.total),offers};
  }
  function parseOnliner(html) {
    if (!/b-searchsubj-form/.test(html)) throw new Error('Onlíner не вернул поисковую выдачу.');
    const headings = [...html.matchAll(/<h2\b[^>]*class=["']wraptxt["'][^>]*>\s*<a\b[^>]*href=["'](\/viewtopic\.php\?t=\d+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi)];
    const offers = headings.slice(0,60).map((match,index) => {
      const fragment = html.slice(match.index,headings[index+1]?.index || match.index+7000);
      const priceText = plain(fragment.match(/class=["']price-primary["'][^>]*>([\s\S]*?)<\//i)?.[1]);
      const currency = /\$|USD/i.test(priceText)?'USD':/€|EUR/i.test(priceText)?'EUR':/ƃ|р\.|BYN/i.test(priceText)?'BYN':'';
      const title = plain(match[2]);
      return {title,url:'https://baraholka.onliner.by'+match[1],price:Number(priceText.replace(/[^\d,.]/g,'').replace(',','.')),currency,condition:/(?:^|\s)(?:новая|новый|новое)(?:\s|$)/iu.test(title)?'Новая':/б\/у/iu.test(title)?'Б/у':''};
    });
    // Onliner does not expose a reliable total here; never treat sample size as total.
    if (!offers.length && !/ничего не найдено|ничего не найден|не найдено|нет (?:объявлений|результатов)/i.test(plain(html))) throw new Error('Не удалось распознать результаты Onlíner. Откройте поиск.');
    return {total:null,offers};
  }
  function summarize(parsed, criteria) {
    const seen = new Set();
    const offers = parsed.offers.filter(offer => {
      if (!offer.url || seen.has(offer.url) || !matches(offer.title,criteria)) return false;
      if (criteria.condition && offer.condition && offer.condition !== criteria.condition) return false;
      seen.add(offer.url); return true;
    });
    const prices = offers.filter(o=>Number.isFinite(o.price)&&o.price>0&&['BYN','USD','EUR'].includes(o.currency));
    const groups = [];
    for (const currency of ['BYN','USD','EUR']) {
      const values = prices.filter(o=>o.currency===currency).map(o=>o.price).sort((a,b)=>a-b);
      if (values.length) groups.push({currency,count:values.length,min:values[0],max:values.at(-1),median:Math.round((values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2*100)/100});
    }
    return {total:parsed.total,scanned:parsed.offers.length,matched:offers.length,unpriced:offers.length-prices.length,groups,offers:offers.map(o=>({...o,price:prices.includes(o)?o.price:null})),unknownCondition:offers.filter(o=>!o.condition).length};
  }
  async function readPage(url) {
    const response = await fetch(url,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(18000)});
    if ([401,403,429].includes(response.status)) throw new Error('Площадка ограничила доступ или требует проверку. Откройте поиск вручную.');
    if (!response.ok) throw new Error(`Поиск временно недоступен (${response.status}).`);
    const reader = response.body.getReader(); let size=0,html=''; const decoder=new TextDecoder('utf-8');
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new Error('Ответ площадки слишком большой.');}html+=decoder.decode(value,{stream:true});}
    html+=decoder.decode();
    if (/<title>[^<]*(?:captcha|access denied|just a moment)/i.test(html) || /нам необходимо убедиться, что вы не бот/i.test(html)) throw new Error('Площадка требует проверку на робота. Откройте поиск вручную.');
    return html;
  }
  async function search(input) {
    const criteria=validate(input), mappings=criteria.recipe.mappings;
    const sources=[];
    if(mappings.kufar){const url=new URL('https://www.kufar.by/l');url.searchParams.set('query',criteria.query);url.searchParams.set('cat',mappings.kufar.id);for(const a of mappings.kufar.attributes||[])if(a.key==='computers_component_type')url.searchParams.set('cct',a.value);sources.push({id:'kufar',name:'Kufar',url:url.href,parse:html=>{const result=parseKufar(html);result.offers=result.offers.filter(o=>o.categoryId===mappings.kufar.id);return result;}});}
    if(mappings.onliner && /^\d+$/.test(mappings.onliner.id)){const url=new URL('https://baraholka.onliner.by/search.php');url.searchParams.set('q',criteria.query);url.searchParams.set('f',mappings.onliner.id);url.searchParams.set('cat',criteria.kind==='service'?'4':'1');url.searchParams.set('topicTitle','1');sources.push({id:'onliner',name:'Onlíner',url:url.href,parse:parseOnliner});}
    if(!sources.length)throw new Error('Для этой категории пока нет подключённого поиска цен.');
    const results=await Promise.all(sources.map(async source=>{
      try {return {id:source.id,name:source.name,url:source.url,status:'ok',...summarize(source.parse(await readPage(source.url)),criteria)};}
      catch(error){return {id:source.id,name:source.name,url:source.url,status:'unavailable',error:/fetch|network|timeout|abort/i.test(error.message||'')?'Не удалось связаться с площадкой. Проверьте доступ или откройте поиск вручную.':error.message || 'Не удалось прочитать поиск.'};}
    }));
    return {query:criteria.query,checkedAt:new Date().toISOString(),results};
  }
  root.AutopostPrices={validate,parseKufar,parseOnliner,summarize,search};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.AutopostPrices;
})(globalThis);
