(function(root){
  'use strict';
  const labels = Object.freeze({visible:'Объявление открывается на площадке.',moderation:'Площадка сообщает: объявление на модерации.',rejected:'Площадка сообщает: объявление отклонено.',inactive:'Площадка сообщает: объявление неактивно.',action_required:'Нужен вход или проверка на площадке.',unknown:'Площадка не показала однозначный статус. Откройте объявление для проверки.'});
  function inspect(document, href, task, visible) {
    const signals = [...document.querySelectorAll('h1,h2,[role="alert"],[role="status"],[data-testid*="status"],[data-name*="status"],.alert,.alert-success,.alert-danger')]
      .filter(visible).map(e=>e.textContent.trim()).filter(text=>text && text.length <= 400);
    const selected = (state,pattern) => { const evidence=signals.find(text=>pattern.test(text)); return evidence ? {state,message:evidence} : null; };
    if ([...document.querySelectorAll('input[type="password"],iframe[src*="captcha" i],iframe[title*="captcha" i]')].some(visible) ||
        signals.some(text=>/^(?:вход|авторизация|войти в аккаунт|проверка безопасности|выполнение проверки безопасности|подтвердите, что вы человек|доступ (?:ограничен|запрещ[её]н))/i.test(text)))
      return {state:'action_required',message:labels.action_required};
    const explicit = selected('rejected',/^(?:ваше\s+)?объявление\s+(?:было\s+)?(?:отклонено|заблокировано)|^отклонено(?:[!.\s]|$)/i) ||
      selected('moderation',/^(?:(?:ваше\s+)?объявление\s+(?:на модерации|на проверке|проверяется|ожидает проверки)|на модерации$|ожидает модерации$)/i) ||
      selected('inactive',/^(?:ваше\s+)?объявление\s+(?:неактивно|закрыто|удалено|снято с (?:публикации|продажи)|в архиве)|^(?:неактивно|в архиве)$/i);
    if (explicit) return explicit;
    if (signals.some(text=>/объявление не найдено|страница не найдена|^404(?:\s|$)/i.test(text))) return {state:'unknown',message:'Объявление не найдено по ссылке. Это не подтверждает причину: отклонение, удаление или неверный адрес.'};
    const publication = root.AutopostPublication;
    if (publication.listingUrl(task.canonicalId,href) === task.url && publication.headings(document,task.canonicalId,visible).some(e=>publication.titleMatches(task.title,e.textContent)))
      return {state:'visible',message:labels.visible};
    return null;
  }
  root.AutopostStatus = {labels,inspect};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AutopostStatus;
})(globalThis);
