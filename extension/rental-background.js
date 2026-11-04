(function (root) {
  "use strict";
  const key = "autopost-rental-jobs-v1",
    core = root.AutopostRentalCore;
  async function load() {
    const rows = (await chrome.storage.session.get(key))[key] || [];
    const live = rows.filter(
      (b) => Date.now() - b.created < 2 * 60 * 60 * 1000,
    );
    const expired = rows.filter((b) => !live.includes(b));
    if (expired.length)
      await root.AutopostPhotos.remove(expired.map((b) => b.photoKey));
    return live;
  }
  const save = (rows) => chrome.storage.session.set({ [key]: rows });
  // The server keeps the history of each job's publication. Reports go through the Autopost tab
  // of the launch; one it could not take waits for that card's next status request.
  async function relay(b, j, status, message) {
    if (j.last?.status === status && j.last?.message === message) return;
    j.last = { status, message };
    j.report = { status, message };
    await deliver(b, j);
  }
  async function deliver(b, j) {
    if (!j.report) return;
    let reply;
    try {
      reply = await chrome.tabs.sendMessage(b.sourceTabId, {
        kind: "RENTAL_REPORT",
        origin: b.origin,
        profileId: b.profileId,
        publication: j.recipe.publication,
        ...j.report,
      });
    } catch {
      return;
    }
    // Taken, or refused by the server for good (e.g. after a submission): nothing to resend.
    if (reply?.ok || (reply?.error && !reply.retry)) j.report = null;
  }
  const summary = (b) => ({
    id: b.id,
    revision: b.revision,
    profileId: b.profileId,
    jobs: b.jobs.map((j) => ({
      id: j.id,
      platform: j.recipe.platform,
      status: j.status,
      message: j.message,
      filled: j.filled || 0,
      remaining: j.remaining || [],
      url: j.url || "",
      mode: b.mode,
    })),
  });
  async function handle(message, sender) {
    const rows = await load(),
      payload = message.payload || {},
      senderOrigin = new URL(sender.url || sender.tab.url).origin;
    if (message.kind === "RENTAL_REQUEST") {
      if (
        !root.AutopostCore.isAppOrigin(senderOrigin) ||
        !core.id(payload.profileId)
      )
        throw new Error("Откройте личный кабинет Автопоста.");
      const own = rows.filter(
        (b) =>
          b.origin === senderOrigin &&
          b.profileId === payload.profileId &&
          b.id === payload.id,
      );
      if (message.type === "RENTAL_STATUS") {
        let changed = false;
        for (const b of own) {
          if (b.sourceTabId !== sender.tab.id) {
            b.sourceTabId = sender.tab.id;
            changed = true;
          }
          for (const j of b.jobs)
            if (j.report) {
              await deliver(b, j);
              changed = true;
            }
        }
        if (changed) await save(rows);
        return {
          jobs: own.length ? summary(own.at(-1)).jobs : [],
          revision: own.at(-1)?.revision,
        };
      }
      if (!message.userGesture) throw new Error("Нажмите кнопку в Автопосте.");
      if (message.type === "RENTAL_OPEN") {
        const b = own.find((b) => b.jobs.some((j) => j.id === payload.jobId)),
          j = b?.jobs.find((j) => j.id === payload.jobId);
        if (!j) throw new Error("Задание устарело. Запустите карточку заново.");
        try {
          if (j.fillBlocked) throw new Error("Restart from the app in a fresh tab");
          await chrome.tabs.update(j.tabId, { active: true });
        } catch {
          const tab = await chrome.tabs.create({
            url: j.recipe.startUrl,
            active: true,
          });
          j.tabId = tab.id;
          root.AutopostCore.armFill(j);
          if (j.status !== "stopped") {
            j.status = "running";
            if (!j.submitted) await relay(b, j, "opened", "Заполняем карточку");
          }
          await save(rows);
        }
        return { ok: true };
      }
      if (message.type === "RENTAL_STOP") {
        for (const b of own)
          for (const j of b.jobs) {
            j.status = "stopped";
            j.message = "Остановлено в Автопосте";
            if (!j.submitted) await relay(b, j, "stopped", j.message);
          }
        await save(rows);
        return { ok: true };
      }
      if (message.type !== "RENTAL_RUN")
        throw new Error("Неизвестная команда.");
      const data = core.validate(payload);
      // A launch is one card revision under one integration version (plans and recipes).
      // Retrying a click or a timed-out response must not open/publish duplicates;
      // new rules for the same revision are a new launch, not a resume of the old jobs.
      const old = own.find(
        (b) =>
          b.revision === data.revision &&
          b.integrationVersion === data.integrationVersion,
      );
      if (old) {
        if (old.jobs.every((j) => j.status === "stopped") || old.jobs.some((j) => j.fillBlocked)) {
          old.sourceTabId = sender.tab.id;
          old.mode = data.mode;
          for (const j of old.jobs) {
            j.status = "running";
            j.message = "Возобновляем заполнение";
            if (!j.submitted) await relay(old, j, "opened", j.message);
          }
          await save(rows);
          for (const j of old.jobs) {
            try {
              if (j.fillBlocked) throw new Error("Restart from the app in a fresh tab");
              await chrome.tabs.get(j.tabId);
            } catch {
              const tab = await chrome.tabs.create({
                url: j.recipe.startUrl,
                active: false,
              });
              j.tabId = tab.id;
              root.AutopostCore.armFill(j);
              await save(rows);
              continue;
            }
            try {
              await chrome.tabs.sendMessage(j.tabId, {
                kind: "RENTAL_WAKE",
                jobId: j.id,
                autoSubmit: core.autoSubmit(old.mode, j.recipe),
              });
            } catch {
              j.status = "needs_action";
              j.fillBlocked = true;
              j.message = "Нажмите «Открыть» в Автопосте для продолжения.";
              if (!j.submitted) await relay(old, j, "needs_action", j.message);
            }
          }
          await save(rows);
        }
        return summary(old);
      }
      if (own.some((b) => b.jobs.some((j) => j.status !== "stopped")))
        throw new Error(
          "У этой карточки уже есть задания. Остановите предыдущий запуск перед передачей новой версии.",
        );
      if (rows.length >= 20)
        throw new Error(
          "Слишком много активных карточек. Закройте завершённые задания.",
        );
      const batch = {
        id: data.id,
        revision: data.revision,
        integrationVersion: data.integrationVersion,
        profileId: data.profileId,
        origin: senderOrigin,
        sourceTabId: sender.tab.id,
        created: Date.now(),
        mode: data.mode,
        photoKey: "rental:" + crypto.randomUUID(),
        jobs: data.jobs.map((recipe) => ({
          id: crypto.randomUUID(),
          recipe,
          status: "opening",
          message: "Открываем форму",
          tabId: null,
        })),
      };
      await root.AutopostPhotos.set(batch.photoKey, data.photos || []);
      rows.push(batch);
      await save(rows);
      for (const j of batch.jobs) {
        try {
          const tab = await chrome.tabs.create({
            url: j.recipe.startUrl,
            active: false,
          });
          j.tabId = tab.id;
          root.AutopostCore.armFill(j);
          j.status = "running";
          j.message = "Заполняем карточку";
          await relay(batch, j, "opened", j.message);
        } catch {
          j.status = "needs_action";
          j.message = "Не удалось открыть вкладку. Нажмите «Открыть».";
          await relay(batch, j, "needs_action", j.message);
        }
        await save(rows);
      }
      return summary(batch);
    }
    const b = rows.find((b) =>
        b.jobs.some(
          (j) =>
            j.tabId === sender.tab.id &&
            core.origin(j.recipe.platform, sender.url || sender.tab.url),
        ),
      ),
      j = b?.jobs.find((j) => j.tabId === sender.tab.id);
    if (!b || !j || j.status === "stopped") return { task: null };
    if (message.type === "GET") {
      const allowed = root.AutopostCore.claimFill(j, sender, payload.navigation, [new URL(j.recipe.startUrl).origin]);
      await save(rows);
      if (!allowed) return { task: null };
      return payload.metadataOnly
        ? { task: { jobId: j.id, submitted: !!j.submitted } }
        : {
            task: {
              jobId: j.id,
              recipe: j.recipe,
              autoSubmit: core.autoSubmit(b.mode, j.recipe),
              photos: (await root.AutopostPhotos.get(b.photoKey)) || [],
              submitted: !!j.submitted,
              photoSent: !!j.photoSent,
            },
          };
    }
    if (!root.AutopostCore.canFill(j, sender)) return { task: null };
    if (message.type === "CLAIM_PHOTOS") {
      if (j.photoSent) return { ok: false };
      j.photoSent = true;
      await save(rows);
      return { ok: true };
    }
    if (message.type === "REPORT") {
      j.status = ["running", "filled", "needs_action"].includes(payload.status)
        ? payload.status
        : "needs_action";
      j.message = String(payload.message || "").slice(0, 500);
      j.filled = Math.max(0, Math.min(150, Number(payload.filled) || 0));
      j.remaining = Array.isArray(payload.remaining)
        ? payload.remaining.slice(0, 150).map((x) => String(x).slice(0, 120))
        : [];
      // Filling progress stays here; the server keeps where the publication stands.
      if (j.status !== "running" && !j.submitted)
        await relay(b, j, j.status, j.message);
      await save(rows);
      return { ok: true };
    }
    if (message.type === "BEFORE_SUBMIT") {
      if (!core.autoSubmit(b.mode, j.recipe) || j.submitted) return { ok: false };
      // The server records the submission and allows it only once, for the launched revision
      // under the launched rules.
      const status = "submitted",
        text = "Выполнена попытка подачи. Проверьте результат и сообщения площадки.";
      const verified = await chrome.tabs
        .sendMessage(b.sourceTabId, {
          kind: "RENTAL_REPORT",
          origin: b.origin,
          profileId: b.profileId,
          publication: j.recipe.publication,
          status,
          message: text,
        })
        .catch(() => null);
      if (!verified?.ok)
        throw new Error(
          verified?.error || "Откройте Автопост для сверки карточки.",
        );
      // Persist before clicking: no duplicate submissions after navigation or worker restart.
      j.submitted = true;
      j.last = { status, message: text };
      j.report = null;
      await save(rows);
      return { ok: true };
    }
    throw new Error("Неизвестная команда формы.");
  }
  root.AutopostRentalBackground = {
    handle,
    photoKeys: async () => (await load()).map((b) => b.photoKey),
  };
})(globalThis);
