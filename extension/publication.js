/* Submission tracking observes visible UI only. It never submits a form or calls a private API. */
(function (root) {
  'use strict';
  const MAX_WAIT_MS = 30 * 60 * 1000;
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim();
  function listingUrl(platform, value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 1500) return null;
      const host = url.hostname.replace(/^www\./,'');
      if (platform === 'kufar' && ['kufar.by','auto.kufar.by'].includes(host) && /^\/item\/[1-9]\d{4,14}\/?$/.test(url.pathname)) {
        url.hostname = host === 'kufar.by' ? 'www.kufar.by' : host;
        url.search = '';
      } else if (platform === 'onliner' && host === 'baraholka.onliner.by' && url.pathname === '/viewtopic.php' &&
                 url.searchParams.getAll('t').length === 1 && /^[1-9]\d{2,14}$/.test(url.searchParams.get('t'))) {
        const id = url.searchParams.get('t'); url.search = '?t='+id;
      } else if (platform === 'bamper' && host === 'bamper.by' && /^\/zapchast_[a-z0-9-]+\/\d+-[a-z0-9_-]+\/?$/i.test(url.pathname)) {
        url.hostname = host; url.search = '';
      } else return null;
      if (url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0,-1);
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function postingUrl(platform, value) {
    try {
      const u = new URL(value), h = u.hostname.replace(/^www\./,'');
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
      return platform === 'kufar' && ['kufar.by','auto.kufar.by'].includes(h) && u.pathname === '/ain/create' ||
        platform === 'onliner' && h === 'baraholka.onliner.by' && u.pathname === '/fleamarketposting.php' && !u.searchParams.has('t') ||
        platform === 'bamper' && h === 'bamper.by' && u.pathname === '/personal/add.php' && u.searchParams.get('action') === 'add';
    } catch { return false; }
  }
  function titleMatches(expected, actual) {
    const tokens = normalize(expected).split(' ').filter(t => t.length > 1 && !['продам','продаю','продажа','купить','для'].includes(t));
    const found = new Set(normalize(actual).split(' '));
    return tokens.length >= 2 && String(actual || '').length <= 400 && tokens.every(t => found.has(t));
  }
  function successText(text) {
    return /^(?:(?:спасибо|поздравляем)[!.,\s]*)?(?:ваше?\s+)?(?:объявление|запчасть)\s+(?:было\s+)?(?:успешно\s+)?(?:добавлен[ао]|создан[ао]|сохран[её]н[ао]|опубликован[ао]|отправлен[ао]\s+на\s+(?:модерацию|проверку)|принят[ао])(?:[!.\s]|$)/i.test(String(text || '').trim());
  }
  function fresh(submission, now = Date.now()) {
    return !!submission && Number.isFinite(submission.at) && now >= submission.at && now-submission.at <= MAX_WAIT_MS;
  }
  function headings(document, platform, visible) {
    // Bamper's public detail page uses h2 for the part name (observed 2026-10-27).
    return [...document.querySelectorAll(platform === 'bamper' ? 'h1,h2' : 'h1')].filter(visible);
  }
  function candidates(document, platform, href, visible) {
    return [...document.querySelectorAll('a[href]')].filter(visible).flatMap(a => {
      try {
        const url = listingUrl(platform, new URL(a.getAttribute('href'),href).href);
        return url ? [{element:a,url}] : [];
      } catch { return []; }
    });
  }
  function existingLinks(document, platform, href, visible) {
    return [...new Set(candidates(document,platform,href,visible).map(c=>c.url))].slice(0,100);
  }
  function submissionTitle(document, platform, listing) {
    const title = document.querySelector(platform === 'onliner' ? '#posting [name="subject"]' : '#ai-form [name="subject"]')?.value;
    if (title?.trim()) return title.trim().slice(0,160);
    if (platform === 'bamper') {
      const values = [['TAG_ID','partName'],['MARKA_ID[]','brand'],['MODEL_ID[]','model'],['YEAR','year']].map(([name,key])=>{
        const field=document.querySelector('#add_form [name="'+name+'"]');
        const value=field?.tagName==='SELECT' ? field.selectedOptions?.[0]?.textContent?.trim() : field?.value?.trim();
        return field?.value && value && !/не (?:указан|выбран)/i.test(value) ? value : listing[key];
      });
      return values.filter(Boolean).join(' ').slice(0,160) || listing.title;
    }
    return listing.title;
  }
  function isSubmitEvent(event, platform, href) {
    if (!event.isTrusted || !postingUrl(platform,href)) return false;
    const formId = {kufar:'ai-form',onliner:'posting',bamper:'add_form'}[platform];
    if (event.type === 'submit') return event.target?.id === formId && (!event.submitter || isSubmitEvent({type:'click',target:event.submitter,isTrusted:true},platform,href));
    if (event.type !== 'click') return false;
    const control = event.target?.closest?.('button,input[type="submit"],a');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true' || control.closest('form')?.id !== formId) return false;
    if (platform === 'onliner') return control.id === 'btnFleaMarketPostingSubmitEnabled';
    const label = (control.textContent || control.value || '').trim();
    return platform === 'kufar' ? label === 'Подать объявление' : control.name === 'submit' && /^Сохранить и добавить ещ[её]$/.test(label);
  }
  function observe(document, platform, href, submission, visible) {
    if (!fresh(submission)) return null;
    const ignored = new Set(submission.existing || []);
    const current = listingUrl(platform,href);
    if (current && !ignored.has(current)) {
      const matched = headings(document,platform,visible).filter(h => titleMatches(submission.title,h.textContent));
      if (matched.length === 1) return {url:current,mode:'detail',title:matched[0].textContent.trim().slice(0,400)};
    }
    const links = candidates(document,platform,href,visible).filter(c=>!ignored.has(c.url));
    const receipts = [];
    for (const c of links) {
      if (!/^(?:посмотреть|просмотреть|открыть)(?: ваше| мое)? объявление$|^перейти к (?:вашему )?объявлению$/i.test(c.element.textContent.trim())) continue;
      let region = c.element.parentElement;
      for (let depth=0; region && depth<3 && !['BODY','HTML'].includes(region.tagName); depth++,region=region.parentElement) {
        const text = region.textContent.trim();
        if (text.length > 1200) break;
        if (successText(text)) { receipts.push({url:c.url,mode:'receipt',text:text.slice(0,1200)}); break; }
      }
    }
    return new Set(receipts.map(c=>c.url)).size === 1 ? receipts[0] : null;
  }
  function validateCapture(platform, submission, capture, senderUrl) {
    if (!fresh(submission) || !capture || capture.attemptId !== submission.id) return null;
    const url = listingUrl(platform,capture.url);
    if (!url || (submission.existing || []).includes(url)) return null;
    if (capture.mode === 'detail' && listingUrl(platform,senderUrl) === url && titleMatches(submission.title,capture.title)) return url;
    if (capture.mode === 'receipt' && typeof capture.text === 'string' && capture.text.length <= 1200 && successText(capture.text)) return url;
    return null;
  }
  const api = {MAX_WAIT_MS,listingUrl,postingUrl,titleMatches,successText,fresh,headings,existingLinks,submissionTitle,isSubmitEvent,observe,validateCapture};
  root.AutopostPublication = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
