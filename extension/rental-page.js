(async function () {
  "use strict";
  if (window !== window.top) return;
  const request = (type, payload) =>
    chrome.runtime.sendMessage({ kind: "RENTAL_PAGE", type, payload });
  let task;
  try {
    task = (await request("GET", { navigation: globalThis.AutopostCore.fillNavigation() }))?.task;
  } catch {
    return;
  }
  if (!task) return;
  const api = globalThis.AutopostRentalForm,
    form = new api.Form(
      task.recipe,
      task.photos,
      async () => !!(await request("CLAIM_PHOTOS"))?.ok,
    );
  form.photoSent = task.photoSent;
  const host = document.createElement("aside");
  host.id = "autopost-rental-helper";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent =
    ":host{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;font:14px/1.4 system-ui;color:#172236;background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:16px;box-shadow:0 4px 24px #0002}button{padding:8px;margin:8px 8px 0 0;cursor:pointer}p{margin:8px 0}";
  const title = document.createElement("strong");
  title.textContent = task.categoryId === "houses_long_term_rent" ? "Автопост · аренда дома" : task.categoryId === "apartments_sale" ? "Автопост · продажа квартиры" : "Автопост · аренда квартиры";
  const status = document.createElement("p"),
    detail = document.createElement("p"),
    retry = document.createElement("button"),
    stop = document.createElement("button");
  retry.textContent = "Повторить заполнение";
  stop.textContent = "Пауза";
  shadow.append(style, title, status, detail, retry, stop);
  document.documentElement.append(host);
  let running = false,
    departed = false,
    paused = false,
    resumeWhenVisible = false,
    idle = 0,
    cycles = 0,
    interval;
  document.addEventListener(
    "input",
    (e) => {
      if (e.isTrusted && !e.composedPath().includes(host))
        form.protect(e.target);
    },
    true,
  );
  document.addEventListener("click", e => {
    if (e.isTrusted && e.target.closest?.('[data-cy^="vas-"]')) form.promotionHandled = true;
    if (task.recipe.platform === "onliner" && resumeWhenVisible && e.isTrusted &&
        e.target.closest?.('a[href$="#progress"]')?.textContent.trim() === "Продолжить") {
      paused = false;
      resumeWhenVisible = false;
      idle = cycles = 0;
    }
  }, true);
  async function report(state, message) {
    status.textContent = message;
    const remaining = form.remaining();
    detail.textContent = remaining.length
      ? "Не перенесено: " + remaining.join(", ")
      : "";
    await request("REPORT", {
      status: state,
      message,
      filled: form.done.size,
      remaining,
    });
  }
  function blocked() {
    return [
      ...document.querySelectorAll(
        'iframe[src*="captcha"],input[type="password"],[name="g-recaptcha-response"]',
      ),
    ].some((e) => api.visible(e));
  }
  async function tick() {
    if (running || paused || departed || document.hidden) return;
    running = true;
    try {
      const current = await request("GET", { metadataOnly: true });
      if (departed || document.hidden) return;
      if (!current?.task) {
        paused = true;
        resumeWhenVisible = false;
        clearInterval(interval);
        status.textContent = "Задание остановлено в Автопосте";
        return;
      }
      if (blocked()) {
        await report(
          "needs_action",
          "Пройдите вход или проверку площадки, затем продолжим.",
        );
        return;
      }
      const changed = await form.tick();
      if (departed || document.hidden) return;
      if (!form.ready()) {
        idle = cycles = 0;
        const loginRequired = task.recipe.platform === "kufar"
          && [...document.querySelectorAll('button')].some(e => api.visible(e)
            && e.textContent.replace(/\s+/g, " ").trim() === "Войти или зарегистрироваться");
        const wrongDeal = task.categoryId !== "apartments_sale" && task.recipe.platform === "kufar"
          && [...document.querySelectorAll('[data-name="re_auction_sale"]')].some(api.visible);
        await report(loginRequired || wrongDeal ? "needs_action" : "running", loginRequired
          ? "Войдите в аккаунт Kufar в открытой вкладке. После входа заполнение продолжится."
          : wrongDeal
          ? "Открыта продажа. Выберите долгосрочную аренду на Kufar; заполнение продолжится автоматически."
          : "Ожидаем открытия формы площадки.");
        return;
      }
      cycles++;
      idle = changed ? 0 : idle + 1;
      if (form.awaitingPhotos() && cycles < 100) idle = 0;
      const reason = form.blockedReason();
      if (reason) {
        idle = cycles = 0;
        await report("needs_action", reason);
        return;
      }
      if (idle < 3) {
        await report("running", "Перенесено полей: " + form.done.size);
        return;
      }
      if (idle >= 8 || cycles >= 100) {
        paused = true;
        resumeWhenVisible = form.remaining().length > 0;
        await report(
          "needs_action",
          form.remaining().length && form.done.size
            ? "Часть полей требует проверки в форме площадки."
            : form.done.size ? "Заполненные данные перенесены. Завершите шаг площадки."
            : "Форма ещё недоступна. Откройте её и нажмите «Повторить заполнение».",
        );
      }
    } catch (e) {
      paused = true;
      resumeWhenVisible = false;
      await report(
        "needs_action",
        String(e.message || "Не удалось заполнить форму"),
      ).catch(() => {});
    } finally {
      running = false;
    }
  }
  retry.onclick = () => {
    paused = false;
    resumeWhenVisible = false;
    idle = 0;
    cycles = 0;
    form.tried.clear();
    form.resumeQueries();
    void tick();
  };
  stop.onclick = () => {
    paused = !paused;
    resumeWhenVisible = false;
    stop.textContent = paused ? "Продолжить" : "Пауза";
    if (!paused) void tick();
  };
  document.addEventListener("visibilitychange", () => {
    if (departed) return;
    idle = cycles = 0;
    if (document.hidden) return;
    form.resumeQueries();
    if (resumeWhenVisible) {
      paused = false;
      resumeWhenVisible = false;
      form.tried.clear();
    }
    void tick();
  });
  interval = setInterval(() => void tick(), 900);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.kind !== "RENTAL_WAKE" ||
      departed ||
      message.jobId !== task.jobId
    )
      return;
    task.mode = message.mode;
    paused = false;
    resumeWhenVisible = false;
    idle = 0;
    cycles = 0;
    clearInterval(interval);
    interval = setInterval(() => void tick(), 900);
    void tick();
    reply({ ok: true });
  });
  window.addEventListener('pagehide', () => {
    departed = true;
    paused = true;
    clearInterval(interval);
    retry.disabled = stop.disabled = true;
    status.textContent = 'Заполнение остановлено. Откройте форму из Автопоста.';
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void request('GET', {navigation:{type:'back_forward',referrer:document.referrer}}).catch(()=>{});
  });
  void tick();
})();
