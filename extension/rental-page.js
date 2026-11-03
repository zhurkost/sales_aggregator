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
  title.textContent = "Автопост · аренда квартиры";
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
    if (running || paused || departed) return;
    running = true;
    try {
      const current = await request("GET", { metadataOnly: true });
      if (departed) return;
      if (!current?.task) {
        paused = true;
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
      cycles++;
      const changed = await form.tick();
      if (departed) return;
      idle = changed ? 0 : idle + 1;
      if (idle < 3) {
        await report("running", "Перенесено полей: " + form.done.size);
        return;
      }
      if (task.autoSubmit === true && !task.submitted && form.ready()) {
        if (api.paymentRequired()) {
          paused = true;
          await report(
            "needs_action",
            "Выбрана платная услуга площадки. Выберите бесплатный вариант или завершите оплату самостоятельно.",
          );
          return;
        }
        if (form.clickStep("next")) {
          idle = 0;
          return;
        }
        const final = (task.recipe.submit || []).flatMap((s) =>
          api
            .targets(s)
            .filter((e) => api.norm(e.textContent) === api.norm(s.text)),
        );
        if (final.length === 1) {
          const ok = await request("BEFORE_SUBMIT");
          if (ok?.error) throw new Error(ok.error);
          if (ok?.ok) {
            task.submitted = true;
            final[0].click();
            await report(
              "needs_action",
              "Выполнена попытка подачи. Проверьте результат и сообщения площадки.",
            );
            paused = true;
            return;
          }
        }
      }
      if (idle >= 8 || cycles >= 100) {
        paused = true;
        await report(
          "needs_action",
          form.done.size
            ? "Заполненные данные перенесены. Завершите шаг площадки."
            : "Форма ещё недоступна. Откройте её и нажмите «Повторить заполнение».",
        );
      }
    } catch (e) {
      paused = true;
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
    idle = 0;
    cycles = 0;
    form.tried.clear();
    void tick();
  };
  stop.onclick = () => {
    paused = !paused;
    stop.textContent = paused ? "Продолжить" : "Пауза";
    if (!paused) void tick();
  };
  interval = setInterval(() => void tick(), 900);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.kind !== "RENTAL_WAKE" ||
      departed ||
      message.jobId !== task.jobId
    )
      return;
    task.autoSubmit = message.autoSubmit === true;
    paused = false;
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
