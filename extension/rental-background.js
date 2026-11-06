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
  const summary = (b) => ({
    id: b.id,
    revision: b.revision,
    profileId: b.profileId,
    categoryId: b.categoryId,
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
          (b.categoryId ?? "apartments_long_term_rent") === (payload.categoryId ?? "apartments_long_term_rent") &&
          b.profileId === payload.profileId &&
          b.id === payload.id,
      );
      if (message.type === "RENTAL_STATUS")
        return {
          jobs: own.length ? summary(own.at(-1)).jobs : [],
          revision: own.at(-1)?.revision,
        };
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
          j.photoSent = false;
          if (j.status !== "stopped") j.status = "running";
          await save(rows);
        }
        return { ok: true };
      }
      if (message.type === "RENTAL_STOP") {
        for (const b of own)
          for (const j of b.jobs) {
            j.status = "stopped";
            j.message = "Остановлено в Автопосте";
          }
        await save(rows);
        return { ok: true };
      }
      if (message.type !== "RENTAL_RUN")
        throw new Error("Неизвестная команда.");
      const data = core.validate(payload);
      const old = own.find((b) => b.revision === data.revision);
      // Retrying a click or a timed-out response must not open/publish duplicates.
      if (old) {
        const restart = old.jobs.every((j) => j.status === "stopped");
        if (restart || old.jobs.some((j) => j.fillBlocked)) {
          old.sourceTabId = sender.tab.id;
          old.mode = data.mode;
          for (const j of old.jobs) {
            j.status = "running";
            j.message = "Возобновляем заполнение";
            // A deliberate Stop -> Publish starts a fresh form. Never reuse
            // per-document completion flags or let the previous tab keep filling.
            if (restart) j.fillBlocked = true;
            const recipe = data.jobs.find(r => r.platform === j.recipe.platform);
            if (recipe) j.recipe = recipe;
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
              j.photoSent = false;
              j.filled = 0;
              j.remaining = [];
              await save(rows);
              continue;
            }
            try {
              await chrome.tabs.sendMessage(j.tabId, {
                kind: "RENTAL_WAKE",
                jobId: j.id,
                mode: old.mode,
              });
            } catch {
              j.status = "needs_action";
              j.fillBlocked = true;
              j.message = "Нажмите «Открыть» в Автопосте для продолжения.";
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
        profileId: data.profileId,
        categoryId: data.categoryId ?? "apartments_long_term_rent",
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
        } catch {
          j.status = "needs_action";
          j.message = "Не удалось открыть вкладку. Нажмите «Открыть».";
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
        ? { task: { jobId: j.id } }
        : {
            task: {
              jobId: j.id,
              categoryId: b.categoryId ?? "apartments_long_term_rent",
              recipe: j.recipe,
              mode: b.mode,
              photos: (await root.AutopostPhotos.get(b.photoKey)) || [],
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
      j.status = ["running", "needs_action", "submitted"].includes(
        payload.status,
      )
        ? payload.status
        : "needs_action";
      j.message = String(payload.message || "").slice(0, 500);
      j.filled = Math.max(0, Math.min(150, Number(payload.filled) || 0));
      j.remaining = Array.isArray(payload.remaining)
        ? payload.remaining.slice(0, 150).map((x) => String(x).slice(0, 120))
        : [];
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
