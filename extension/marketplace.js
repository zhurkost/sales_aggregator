(async function () {
  "use strict";
  const core = globalThis.AutopostCore,
    dom = globalThis.AutopostDOM,
    publication = globalThis.AutopostPublication,
    automatic = globalThis.AutopostAutoPublish;
  const platform = core.platformForOrigin(location.origin);
  if (window !== window.top || !platform) return;
  let task;
  try {
    task = (await chrome.runtime.sendMessage({ kind: "GET_TASK" }))?.task;
  } catch {
    return;
  }
  if (!task) return;
  let busy = false,
    stopped = false,
    scheduled = null,
    arming = false,
    lastSubmitAt = 0,
    lastReport = "",
    autoReadySince = 0,
    navigationAttempts = 0;
  const filled = new Set(task.filledKeys || []),
    attempted = new Map();
  const node = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const host = node("div");
  host.id = "autopost-helper-panel";
  host.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 24px)";
  const shadow = host.attachShadow({ mode: "closed" }),
    style = node("style");
  style.textContent =
    ":host{all:initial}*{box-sizing:border-box}.panel{font:13px/1.55 system-ui;background:#142631;color:#eef4f9;border:1px solid #557082;border-radius:16px;width:360px;max-width:calc(100vw - 24px);padding:17px;box-shadow:0 10px 40px #0005}.top,.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top{justify-content:space-between}h2{font-size:17px;margin:0}p{margin:9px 0}button,input{font:inherit;border:1px solid #637f91;border-radius:7px;padding:8px;background:#253e4e;color:#fff}button{cursor:pointer}button.primary{background:#c5ef94;color:#193018;border-color:#c5ef94}button:disabled{opacity:.5}button:focus-visible,input:focus-visible{outline:3px solid #b7c9ff}input{width:100%;margin:8px 0}.muted{font-size:11px;color:#bbcfdb}.status{background:#294454;border-radius:8px;padding:10px}.body{max-height:68vh;overflow:auto}details{margin:10px 0}pre{font:12px/1.5 system-ui;white-space:pre-wrap;max-height:200px;overflow:auto;background:#0c1922;padding:10px}ul{padding-left:18px;max-height:180px;overflow:auto}.hidden{display:none}";
  shadow.append(style);
  const panel = node("section", undefined, "panel"),
    top = node("div", undefined, "top"),
    heading = node("h2", "Автопост · " + task.name),
    collapse = node("button", "Свернуть"),
    body = node("div", undefined, "body");
  collapse.type = "button";
  collapse.onclick = () => {
    body.classList.toggle("hidden");
    collapse.textContent = body.classList.contains("hidden")
      ? "Развернуть"
      : "Свернуть";
  };
  top.append(heading, collapse);
  const title = node("p", task.listing.title),
    status = node("p", "Открываем форму и заполняем карточку…", "status"),
    counts = node("p", ""),
    photos = node("p", "", "muted"),
    actions = node("div", undefined, "actions"),
    retry = node("button", "Повторить заполнение", "primary"),
    copy = node("button", "Скопировать текст");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = node("details"),
    summary = node("summary", "Результат заполнения"),
    list = node("ul");
  details.append(summary, list);
  const manual = node("details"),
    pre = node("pre");
  manual.append(node("summary", "Карточка объявления"), pre);
  function text() {
    return [
      task?.listing.title,
      task?.listing.description,
      ...Object.entries(task?.listing || {})
        .filter(
          ([k, v]) =>
            v &&
            !["category", "taxonomyId", "title", "description"].includes(k),
        )
        .map(([k, v]) => k + ": " + v),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  pre.textContent = text();
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text());
      copy.textContent = "Скопировано";
    } catch {
      manual.open = true;
    }
  };
  retry.onclick = async () => {
    if (task?.submission) {
      try {
        const result = await chrome.runtime.sendMessage({kind:"RESET_SUBMISSION",jobId:task.jobId});
        if (!result?.ok) { status.textContent = result?.error || "Не удалось возобновить заполнение."; return; }
        task.submission = null;
      } catch { status.textContent = "Не удалось связаться с расширением."; return; }
    }
    void fill(true);
  };
  actions.append(retry, copy);
  const urlLabel = node("label", "Ссылка на готовое объявление"),
    urlInput = node("input");
  urlInput.type = "url";
  urlInput.placeholder = "https://…";
  urlInput.setAttribute("aria-label", "Ссылка на опубликованное объявление");
  const confirm = node(
      "button",
      "Сохранить ссылку и продолжить очередь",
      "primary",
    ),
    saveCurrent = node("button", "Сохранить ссылку этой страницы", "primary"),
    skip = node("button", "Пропустить это задание");
  saveCurrent.hidden = true;
  saveCurrent.onclick = () => {
    const url = publication.listingUrl(platform.id,location.href);
    if (!url) return;
    urlInput.value = url;
    void confirm.onclick();
  };
  confirm.onclick = async () => {
    const url = core.safeLink(platform.id, urlInput.value);
    if (!url) {
      status.textContent =
        "Нужна HTTPS-ссылка на объявление именно этой площадки.";
      return;
    }
    const saved = await report(
      "link_recorded",
      "Ссылка сохранена пользователем. Текущий статус площадки ещё не проверен.",
      [],
      { url, userConfirmed: true },
    );
    if (saved) stop(
      "Ссылка передана в Автопост. Следующее объявление очереди откроется автоматически.",
    );
  };
  skip.onclick = async () => {
    const saved = await report("cancelled", "Задание пропущено пользователем.");
    if (saved) stop(
      "Задание остановлено. Следующее объявление очереди открывается автоматически.",
    );
  };
  const manualLink = node("details");
  manualLink.append(node("summary", "Указать ссылку вручную"),urlLabel,urlInput,confirm);
  body.append(
    title,
    status,
    counts,
    photos,
    actions,
    details,
    manual,
    node(
      "p",
      "Используется ваша сессия сайта. Режим отправки выбирается в Автопосте. Пароли не передаются.",
      "muted",
    ),
    node("p", "После подачи ссылка сохранится автоматически, если площадка покажет готовое объявление или подтверждение со ссылкой. Если открывается список объявлений, откройте своё в этой же вкладке.", "muted"),
    saveCurrent,
    manualLink,
    skip,
  );
  panel.append(top, body);
  shadow.append(panel);
  document.documentElement.append(host);
  function captcha() {
    return (
      [
        ...document.querySelectorAll(
          'iframe[src*=\"captcha\" i],iframe[title*=\"captcha\" i],.g-recaptcha,.h-captcha',
        ),
      ].some(dom.visible) &&
      ![
        ...document.querySelectorAll(
          '[name=\"g-recaptcha-response\"],[name=\"h-captcha-response\"]',
        ),
      ].some((e) => e.value?.trim())
    );
  }
  async function report(state, message, skipped = [], extra = {}) {
    if (!task || stopped) return false;
    status.textContent = message;
    counts.textContent = "Заполнено полей: " + filled.size + ".";
    const signature = JSON.stringify([
      state,
      message,
      [...filled],
      task.photosTransferred,
      skipped,
      extra,
    ]);
    if (signature === lastReport) return false;
    lastReport = signature;
    try {
      const r = await chrome.runtime.sendMessage({
        kind: "REPORT_TASK",
        report: {
          jobId: task.jobId,
          status: state,
          message,
          filledKeys: [...filled],
          skippedFields: skipped,
          photosAttempted: !!task.photosAttempted,
          photosTransferred: task.photosTransferred || 0,
          ...extra,
        },
      });
      if (r?.error) {
        lastReport = "";
        status.textContent = r.error;
      } else if (r?.task === null)
        stop("Сеанс завершён. Возобновите задание из личного кабинета.");
      else if (r?.ok) return true;
    } catch {
      lastReport = "";
      status.textContent += " Статус не удалось передать: обновите расширение.";
    }
    return false;
  }
  async function armSubmission(event) {
    if (!task || stopped || task.paused || !publication.isSubmitEvent(event,platform.id,location.href)) return;
    if (arming || Date.now()-lastSubmitAt < 1500) return; // click and native submit describe the same attempt.
    lastSubmitAt = Date.now();
    arming = true;
    const title = publication.submissionTitle(document,platform.id,task.listing);
    const existing = publication.existingLinks(document,platform.id,location.href,dom.visible);
    task.submission = {at:Date.now(),title,existing}; // stop routing immediately, before the worker replies.
    try {
      const result = await chrome.runtime.sendMessage({kind:"ARM_SUBMISSION",jobId:task.jobId,userGesture:true,title,existing});
      if (!task || stopped) return;
      if (result?.ok) task.submission = result.submission;
      else { task.submission = null; status.textContent = result?.error || "Не удалось включить сохранение ссылки."; }
    } catch {
      if (task) task.submission = null;
      status.textContent = "Не удалось связаться с расширением. Ссылку можно сохранить кнопкой в панели.";
    } finally { arming = false; }
    if (!busy) void fill();
  }
  document.addEventListener("click",armSubmission,true);
  document.addEventListener("submit",armSubmission,true);
  async function capturePublication() {
    saveCurrent.hidden = !publication.listingUrl(platform.id,location.href);
    if (!task.submission) return false;
    if (arming) return true;
    const candidate = publication.observe(document,platform.id,location.href,task.submission,dom.visible);
    if (candidate) {
      const saved = await report("link_recorded",
        "Ссылка сохранена автоматически. Статус модерации ещё не проверен.",[],
        {url:candidate.url,capture:{...candidate,attemptId:task.submission.id}});
      if (saved) stop("Ссылка сохранена автоматически и появится в кабинете Автопоста. Следующая карточка очереди откроется автоматически.");
    } else {
      if (task.submission.automatic && (captcha() || automatic?.error(document,dom.visible) || Date.now()-task.submission.at>60000)) {
        await report(captcha()?'captcha_required':'manual_required',captcha()
          ? 'Площадка запросила CAPTCHA после отправки. Пройдите её в этой вкладке; повторной автоматической отправки не будет.'
          : 'Результат отправки не подтверждён. Проверьте форму и список своих объявлений; повторная автоматическая отправка отключена, чтобы не создать дубль.');
        return true;
      }
      status.textContent = publication.fresh(task.submission)
        ? "Ожидаем результат подачи. Если форма показывает ошибку, исправьте её и отправьте ещё раз. Готовое объявление откройте в этой вкладке — ссылка сохранится автоматически."
        : "Не удалось однозначно распознать результат подачи. Откройте готовое объявление и нажмите «Сохранить ссылку этой страницы».";
    }
    return true;
  }
  async function attachPhotos() {
    if (!task.photos.length) {
      photos.textContent =
        "В карточке нет фото. Добавьте фотографии перед подачей.";
      return;
    }
    if (task.photosAttempted) {
      photos.textContent =
        "Передано файлов: " +
        task.photosTransferred +
        " из " +
        task.photos.length +
        ". Проверьте миниатюры на сайте.";
      return;
    }
    const knownInput = automatic?.fileInput(document,platform.id);
    const inputs = (knownInput ? [knownInput] : [
      ...document.querySelectorAll('input[type=\"file\"]'),
    ]).filter(
      (e) =>
        !e.disabled && (!e.accept || /image|jpg|jpeg|png|webp/i.test(e.accept)),
    );
    if (inputs.length !== 1) {
      photos.textContent =
        "Фото ожидают доступного поля загрузки. После входа передача продолжится.";
      return;
    }
    const input = inputs[0];
    if (input.files?.length) {
      photos.textContent = "В поле уже выбраны файлы. Они сохранены.";
      return;
    }
    const accepted = task.photos.filter(
      (p) =>
        !input.accept ||
        input.accept
          .split(",")
          .some((a) =>
            [
              "image/*",
              p.type,
              "." + p.name.split(".").at(-1).toLowerCase(),
            ].includes(a.trim().toLowerCase()),
          ),
    );
    const chosen = input.multiple ? accepted : accepted.slice(0, 1);
    if (!chosen.length) return;
    try {
      const transfer = new DataTransfer();
      for (const p of chosen) {
        const bytes = Uint8Array.from(atob(p.dataUrl.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        transfer.items.add(new File([bytes], p.name, { type: p.type }));
      }
      input.files = transfer.files;
      task.photosAttempted = true;
      task.photosTransferred = input.files.length;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      photos.textContent =
        "Передано файлов: " +
        task.photosTransferred +
        ". Дождитесь миниатюр и проверьте загрузку.";
    } catch {
      photos.textContent =
        "Поле загрузки не приняло файлы. Добавьте их на площадке.";
    }
  }
  async function autoSubmit(result, categoryReady) {
    if (task.publishMode!=='automatic') {autoReadySince=0;return false;}
    if (task.autoAttempt) {
      await report('manual_required','Автоматическая отправка уже выполнялась. Проверьте результат на площадке; повторная отправка возможна вручную.');
      return true;
    }
    automatic.prepareFree(document,platform.id,task);
    const ready=automatic.inspect(document,platform.id,location.href,task,result,categoryReady,dom.visible);
    if (!ready.ready) {
      autoReadySince=0;
      await report('manual_required',ready.message,result.skipped);
      return true;
    }
    if (!autoReadySince) autoReadySince=Date.now();
    if (Date.now()-autoReadySince<4000) {
      await report('auto_checking','Автоматический режим: данные готовы, проверяем устойчивость формы перед отправкой.',result.skipped);
      return true;
    }
    await report('auto_checking','Автоматический режим: отправляем карточку.',result.skipped);
    const granted=await chrome.runtime.sendMessage({kind:'AUTO_BEGIN',jobId:task.jobId,
      title:publication.submissionTitle(document,platform.id,task.listing),
      existing:publication.existingLinks(document,platform.id,location.href,dom.visible)});
    if (!granted?.ok) {await report('manual_required',granted?.error||'Отправка не подтверждена. Проверьте задание в кабинете.');return true;}
    task.submission=granted.submission;task.autoAttempt=granted.submission.id;
    const recheck=automatic.inspect(document,platform.id,location.href,task,result,categoryReady,dom.visible);
    if (task.paused || task.publishMode!=='automatic' || !recheck.ready || captcha()) {
      await report('manual_required','Отправка отменена: режим, форма или проверка площадки изменились. Продолжите вручную.');return true;
    }
    recheck.control.click();
    return true;
  }
  function hasForm() {
    return (
      !!dom.findNative("description", platform.id) ||
      !!document.querySelector('[data-name=\"category\"]')
    );
  }
  async function route() {
    if (hasForm()) return true;
    if (
      [...document.querySelectorAll('input[type=\"password\"]')].some(
        dom.visible,
      ) ||
      location.hostname === "profile.onliner.by" ||
      /\/(?:login|auth|signin)(?:\/|$)/i.test(location.pathname)
    )
      return false;
    if (navigationAttempts >= 2) return false;
    const names =
      task.listing.category === "cars"
        ? [
            "Подать объявление",
            "Продать автомобиль",
            "Разместить объявление",
            "Добавить объявление",
          ]
        : [
            "Подать объявление",
            "Добавить запчасть",
            "Добавить объявление",
            "Разместить объявление",
          ];
    for (const label of names) {
      const hits = dom.exact(label, document, 'a,button,[role=\"button\"]');
      if (hits.length === 1) {
        const href = hits[0].getAttribute("href");
        if (
          href &&
          !core.platformForOrigin(
            core.originOf(new URL(href, location.href).href),
          )
        )
          continue;
        navigationAttempts++;
        hits[0].click();
        return false;
      }
    }
    return false;
  }
  async function fill(manual = false) {
    if (busy || stopped || !task) return;
    if (manual) task.attempts = new Map();
    if (task.paused) {
      status.textContent = "Очередь приостановлена в Автопосте.";
      return;
    }
    if (Date.now() >= task.expiresAt) {
      stop(
        "Сеанс истёк. Карточка сохранена в личном кабинете; запустите размещение заново.",
      );
      return;
    }
    busy = true;
    retry.disabled = true;
    try {
      if (await capturePublication()) return;
      if (publication.listingUrl(platform.id,location.href)) {
        status.textContent = "Открыто готовое объявление. Если оно относится к этой карточке, сохраните ссылку кнопкой ниже.";
        return; // Never click 'add listing' on a result page.
      }
      if (platform.manual) {
        await report(
          "manual_required",
          "ABW требует разрешения на автоматическую подачу. Карточка доступна в панели; после размещения сохраните ссылку.",
        );
        return;
      }
      if (captcha()) {
        await report(
          "captcha_required",
          "Пройдите CAPTCHA на сайте. После проверки заполнение продолжится.",
        );
        return;
      }
      await route();
      if (!hasForm()) {
        await report(
          "authorization_required",
          "Войдите в аккаунт площадки. Помощник продолжит после входа; если форма не открылась, нажмите кнопку подачи на сайте.",
        );
        return;
      }
      const categoryReady = await dom.category(task, platform.id);
      const result = await dom.fillFields(task, platform.id);
      result.filled.forEach((k) => filled.add(k));
      list.replaceChildren(...result.details.map((s) => node("li", s)));
      await attachPhotos();
      const login =
        [...document.querySelectorAll('input[type=\"password\"]')].some(
          dom.visible,
        ) || !!document.querySelector('[data-name=\"about_seller_mock\"]');
      if (!login && await autoSubmit(result,categoryReady)) return;
      const state = login
        ? "authorization_required"
        : !categoryReady
          ? "category_required"
          : filled.size
            ? "review_required"
            : "manual_required";
      const message = login
        ? "Доступные поля заполнены. Войдите на площадку для фото, контактов и подачи."
        : !categoryReady
          ? "Подтвердите точную категорию на площадке; заполнение остальных полей продолжается."
          : filled.size
            ? "Проверьте данные и фотографии. Завершите подачу на сайте — помощник попробует сохранить ссылку автоматически."
            : "Форма не распознана. Откройте подробности ниже; карточка остаётся в Автопосте.";
      await report(state, message, result.skipped);
    } catch (e) {
      await report(
        "error",
        "Заполнение остановилось: " +
          String(e.message || "площадка изменила форму").slice(0, 180),
      );
    } finally {
      busy = false;
      retry.disabled = stopped;
    }
  }
  const observer = new MutationObserver(() => {
    if (!stopped && !scheduled && !busy)
      scheduled = setTimeout(() => {
        scheduled = null;
        void fill();
      }, 1500);
  });
  function stop(message) {
    stopped = true;
    observer.disconnect();
    clearTimeout(scheduled);
    clearInterval(poll);
    retry.disabled = copy.disabled = confirm.disabled = skip.disabled = saveCurrent.disabled = true;
    document.removeEventListener("click",armSubmission,true);
    document.removeEventListener("submit",armSubmission,true);
    pre.textContent = "";
    status.textContent = message;
    task = null;
  }
  const poll = setInterval(async () => {
    if (stopped) return;
    try {
      const response = await chrome.runtime.sendMessage({ kind: "GET_TASK" });
      if (!response?.task) {
        stop("Задание больше не активно. Возобновите его в Автопосте.");
        return;
      }
      task.paused = response.task.paused;
      task.publishMode = response.task.publishMode;
      task.autoAttempt = response.task.autoAttempt;
      if (!arming) task.submission = response.task.submission;
      if (response.task.complete) {
        stop("Задание завершено. Сведения сохранены в личном кабинете.");
        return;
      }
      if (!task.paused && !busy) void fill();
    } catch {}
  }, 8000);
  chrome.runtime.onMessage.addListener((m, s) => {
    if (s.id === chrome.runtime.id && m?.kind === 'TASK_MODE' && task) {
      task.paused=m.paused;task.publishMode=m.publishMode;autoReadySince=0;
      if(!busy)void fill();
    }
    if (s.id === chrome.runtime.id && m?.kind === "TASK_CLEARED")
      stop("Сеанс очищен. Карточка остаётся в личном кабинете.");
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden"],
  });
  if (task.complete)
    stop("Задание завершено. Сведения сохранены в личном кабинете.");
  else await fill();
})();
