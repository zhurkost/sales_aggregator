/* Navigate visible controls and the AV car draft route supplied in page source. */
(function (root) {
  "use strict";
  const core = root.AutopostCore;
  const controls = 'a,button,[role="button"]';
  function pageKey(value) {
    try {
      const url = new URL(value);
      return url.origin + (url.pathname.replace(/\/+$/, "") || "/");
    } catch { return ""; }
  }
  function avCategoryPage(value) {
    try { return core.platformForOrigin(new URL(value).origin)?.id === "av" && /^\/new[-_]?ad\/?$/i.test(new URL(value).pathname); }
    catch { return false; }
  }
  function avDraftPage(value) {
    try { const url = new URL(value); return core.platformForOrigin(url.origin)?.id === "av" && /^\/offer\/draft\/cars\/?$/.test(url.pathname); }
    catch { return false; }
  }
  function target(id, href, from) {
    try {
      const url = core.safeLink(id, new URL(href, from).href);
      return url && pageKey(url) !== pageKey(from) ? url : "";
    } catch { return ""; }
  }
  function canClaim(id, from, step, to, listing) {
    if (!core.safeLink(id, from) || !["entry", "vehicle-category"].includes(step)) return false;
    if (to !== null && (!to || !target(id, to, from))) return false;
    if (step === "vehicle-category") return id === "av" && listing.category === "cars" && avCategoryPage(from) && (to === null || avDraftPage(to));
    // Once inside AV's wizard, the global header must never restart it.
    return id !== "av" || new URL(from).pathname === "/";
  }
  function candidates(doc, scope, labels, id, from, dom, category) {
    for (const label of labels) {
      const matches = new Set();
      // A category card may include a separate label and descriptive text.
      for (const el of scope.querySelectorAll(category ? `${controls},span,strong,div,h2,h3` : controls)) {
        if (core.normalize(el.textContent) !== core.normalize(label)) continue;
        const control = el.matches(controls) ? el : el.closest(controls);
        if (!control || !scope.contains(control) || !dom.visible(control) || control.disabled ||
            control.closest('[inert],[aria-disabled="true"],#autopost-helper-panel') ||
            category && control.closest('header,nav,footer,[role="navigation"]')) continue;
        const href = control.getAttribute("href");
        const url = href === null ? null : target(id, href, from);
        if (href !== null && !url) continue;
        if (category && url && !avDraftPage(url)) continue;
        // Do not use a final form submit as a navigation shortcut.
        if (control.tagName === "BUTTON" && control.form && control.type === "submit") continue;
        matches.add(control);
      }
      if (matches.size === 1) {
        const control = [...matches][0], href = control.getAttribute("href");
        return {control, to: href === null ? null : target(id, href, from)};
      }
      if (matches.size > 1) return null;
    }
    return null;
  }
  function plan(doc, id, from, task, dom, formPresent) {
    if (formPresent) return {state: "form"};
    const url = new URL(from);
    if ([...doc.querySelectorAll('input[type="password"]')].some(dom.visible) ||
        url.hostname === "profile.onliner.by" || /\/(?:login|auth|signin)(?:\/|$)/i.test(url.pathname))
      return {status: "authorization_required", message: "Войдите в аккаунт площадки. Помощник продолжит после входа."};
    // AV mounts its wizard one field at a time, before the description exists.
    if (id === "av" && avDraftPage(from)) return {state: "form"};
    let step = "entry", labels;
    if (id === "av" && avCategoryPage(from)) {
      step = "vehicle-category";
      // AV is currently mapped only for passenger cars; do not infer another vehicle type.
      if (task.listing.category !== "cars" || task.mapping?.id && task.mapping.id !== "cars")
        return {status: "category_required", message: "Для этой карточки не найдена категория транспорта AV.by. Проверьте категорию в Автопосте."};
      labels = [...(task.mapping?.path?.slice(-1) || []), "Легковые автомобили", "Легковые авто", "Легковые", "Автомобили"];
    } else if (id === "av" && url.pathname !== "/") {
      return {status: "manual_required", message: "Ожидаем поля объявления AV.by. Повторный переход к началу подачи отключён; заполнение продолжится, когда появится форма."};
    } else {
      labels = task.listing.category === "cars"
        ? ["Подать объявление", "Продать автомобиль", "Разместить объявление", "Добавить объявление"]
        : ["Подать объявление", "Добавить запчасть", "Добавить объявление", "Разместить объявление"];
    }
    const category = step === "vehicle-category";
    const fallback = {status: category ? "category_required" : "manual_required", message: category
      ? "Не удалось однозначно найти категорию легковых автомобилей на AV.by. Помощник продолжит при появлении кнопки; можно выбрать её на сайте."
      : "Ожидаем форму подачи объявления. Если она не появилась, откройте её на площадке."};
    if (task.navigationSteps?.[step]) return {...fallback, message: category
      ? "Переход к легковым автомобилям уже выполнен. Ожидаем форму; повторное нажатие отключено, чтобы страница не перезагружалась."
      : "Переход к подаче уже выполнен. Ожидаем форму; повторный переход отключён, чтобы страница не перезагружалась."};
    const scope = category ? doc.querySelector('main,[role="main"]') || doc.body : doc;
    const action = candidates(doc, scope, labels, id, from, dom, category) || (category
      // Verified in user-supplied __NEXT_DATA__: page /offer/draft/[advertType], advertType=cars.
      ? {control: null, to: "https://av.by/offer/draft/cars"} : null);
    return action ? {...action, step, status: "auto_checking", message: category
      ? "Выбираем категорию «Легковые автомобили» на AV.by."
      : "Открываем форму подачи объявления."} : fallback;
  }
  root.AutopostNavigation = Object.freeze({pageKey, avCategoryPage, avDraftPage, target, canClaim, plan});
  if (typeof module !== "undefined" && module.exports) module.exports = root.AutopostNavigation;
})(globalThis);
