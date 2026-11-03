const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const core = require("../rental-core.js");
const recipe = (p) =>
  JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../data/rental/apartments_long_term_rent/runtime/browser_" +
          p +
          ".json",
      ),
      "utf8",
    ),
  );
const payload = () => ({
  id: "card",
  profileId: "owner",
  revision: 1,
  mode: "automatic",
  draft: { values: {} },
  jobs: Object.keys(core.starts).map(recipe),
  photos: [],
});
test("rental launch accepts partial cards for all four sites, independent of advisory readiness", () => {
  const p = payload();
  p.jobs.forEach((j) => (j.controls = []));
  const result = core.validate(p);
  assert.equal(result.jobs.length, 4);
  assert.deepEqual(result.draft.values, {});
  for (const wrong of [
    "https://www.kufar.by.evil.test/ain/create",
    "javascript:alert(1)",
  ]) {
    const q = payload();
    q.jobs[0].startUrl = wrong;
    assert.throws(() => core.validate(q));
  }
  const q = payload();
  q.jobs.push(q.jobs[0]);
  assert.throws(() => core.validate(q));
});
test("rental jobs accept only a boolean dataReady from the server", () => {
  for (const dataReady of [true, false, undefined]) {
    const p = payload();
    p.jobs[0].dataReady = dataReady;
    assert.equal(core.validate(p).jobs[0].dataReady, dataReady);
  }
  for (const dataReady of ["true", 1, null, {}]) {
    const p = payload();
    p.jobs[0].dataReady = dataReady;
    assert.throws(() => core.validate(p), /Обновите правила площадки/);
  }
});
function worker() {
  const data = {},
    created = [],
    photos = new Map(),
    sent = [];
  const state = { verify: { ok: true } };
  const chrome = {
    storage: {
      session: {
        async get(k) {
          return { [k]: structuredClone(data[k]) };
        },
        async set(v) {
          Object.assign(data, structuredClone(v));
        },
      },
    },
    tabs: {
      async create(o) {
        const t = { ...o, id: created.length + 10 };
        created.push(t);
        return t;
      },
      async update() {},
      async get(id) {
        const tab = created.find((t) => t.id === id);
        if (!tab) throw new Error("closed");
        return tab;
      },
      async sendMessage(tabId, message) {
        sent.push({ tabId, message });
        return state.verify;
      },
    },
  };
  const context = vm.createContext({
    chrome,
    URL,
    Date,
    crypto,
    structuredClone,
    AutopostCore: require("../core.js"),
    AutopostRentalCore: core,
    AutopostPhotos: {
      get: async (k) => photos.get(k),
      set: async (k, p) => photos.set(k, p),
      remove: async (keys) => keys.forEach((k) => photos.delete(k)),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../rental-background.js"), "utf8"),
    context,
  );
  const app = { url: "https://87.199.205.227/", tab: { id: 1 } },
    handle = (message, sender) => context.AutopostRentalBackground.handle(
      message.type === "GET" ? {...message, payload:{navigation:{type:"navigate",referrer:""},...message.payload}} : message,
      {documentId:`document-${sender.tab.id}`,...sender},
    );
  return { handle, created, sent, state, app };
}
test("rental worker opens every selected site once and isolates profile, origin and assigned tab", async () => {
  const { handle, created, state, app } = worker(),
    ready = () => {
      const p = payload();
      p.jobs.forEach((j) => (j.dataReady = true));
      return p;
    };
  const run = () =>
    handle(
      {
        kind: "RENTAL_REQUEST",
        type: "RENTAL_RUN",
        payload: ready(),
        userGesture: true,
      },
      app,
    );
  assert.equal((await run()).jobs.length, 4);
  await run();
  assert.equal(created.length, 4);
  const status = async (profileId) =>
    (
      await handle(
        {
          kind: "RENTAL_REQUEST",
          type: "RENTAL_STATUS",
          payload: { profileId, id: "card" },
        },
        app,
      )
    ).jobs;
  assert.equal((await status("other")).length, 0);
  assert.equal(
    (
      await handle(
        { kind: "RENTAL_PAGE", type: "GET" },
        { url: core.starts.kufar, tab: { id: 99 } },
      )
    ).task,
    null,
  );
  assert.equal(
    (
      await handle(
        { kind: "RENTAL_PAGE", type: "GET" },
        { url: core.starts.onliner, tab: { id: 10 } },
      )
    ).task,
    null,
  );
  const sender = { url: core.starts.kufar, tab: { id: 10 } };
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender)).task.recipe
      .platform,
    "kufar",
  );
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "CLAIM_PHOTOS" }, sender)).ok,
    true,
  );
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "CLAIM_PHOTOS" }, sender)).ok,
    false,
  );
  state.verify = { error: "Карточка изменилась" };
  await assert.rejects(() =>
    handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender),
  );
  state.verify = { ok: true };
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender)).ok,
    true,
  );
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender)).ok,
    false,
  );
  await handle(
    {
      kind: "RENTAL_REQUEST",
      type: "RENTAL_STOP",
      payload: { profileId: "owner", id: "card" },
      userGesture: true,
    },
    app,
  );
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender)).task,
    null,
  );
  await run();
  assert.equal(created.length, 4);
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender)).task.submitted,
    true,
  );
  assert.equal(
    (await handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender)).ok,
    false,
  );
  // Refresh is a new document, even with the same URL, referrer and assigned tab.
  const refreshed = {...sender,documentId:"refreshed"};
  assert.equal((await handle({kind:"RENTAL_PAGE",type:"GET",payload:{navigation:{type:"reload",referrer:app.url}}},refreshed)).task,null);
  assert.equal((await handle({kind:"RENTAL_PAGE",type:"GET",payload:{metadataOnly:true}},refreshed)).task,null);
  assert.equal((await handle({kind:"RENTAL_PAGE",type:"CLAIM_PHOTOS"},refreshed)).task,null);
  const job = (await status("owner"))[0];
  await handle({kind:"RENTAL_REQUEST",type:"RENTAL_OPEN",userGesture:true,payload:{id:"card",profileId:"owner",jobId:job.id}},app);
  const reopened = {...sender,tab:{id:created.at(-1).id},documentId:"reopened"};
  assert.notEqual(reopened.tab.id,sender.tab.id);
  assert.ok((await handle({kind:"RENTAL_PAGE",type:"GET"},reopened)).task);
  assert.equal((await handle({kind:"RENTAL_PAGE",type:"GET"},refreshed)).task,null);
  // The explicit open must preserve the one-shot submission guard.
  assert.equal((await handle({kind:"RENTAL_PAGE",type:"BEFORE_SUBMIT"},reopened)).ok,false);
  assert.equal((await handle({kind:"RENTAL_PAGE",type:"GET",payload:{navigation:{type:"reload",referrer:""}}},{...reopened,documentId:"reload-again"})).task,null);
  const beforeRun = created.length;
  await run();
  assert.equal(created.length,beforeRun+1,'Publish reopens only the refreshed job');
  assert.ok((await handle({kind:"RENTAL_PAGE",type:"GET"},{...sender,tab:{id:created.at(-1).id},documentId:"published-open"})).task);
});
async function fixture(html, controls, extra = {}) {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "https://www.kufar.by/ain/create" });
  window.document.body.innerHTML = html;
  window.eval(
    fs.readFileSync(path.join(__dirname, "../rental-autocomplete.js"), "utf8"),
  );
  window.eval(
    fs.readFileSync(path.join(__dirname, "../rental-form.js"), "utf8"),
  );
  const form = new window.AutopostRentalForm.Form({
    controls,
    setup: [],
    next: [],
    submit: [],
    ...extra,
  });
  return { window, document: window.document, form };
}
test("form transfers decimal zero and false, leaves missing and existing/user-edited fields intact", async () => {
  const f = await fixture(
    '<input id="price"><input id="checked" type="checkbox" checked><textarea id="text">Мой текст</textarea><input id="empty">',
    [
      { field: "price", selector: "#price", action: "text", value: 0 },
      { field: "check", selector: "#checked", action: "check", value: false },
      {
        field: "text",
        selector: "#text",
        action: "text",
        value: "Другой текст",
      },
      { field: "empty", selector: "#empty", action: "text", value: "" },
    ],
  );
  await f.form.tick();
  assert.equal(f.document.querySelector("#price").value, "0");
  assert.equal(f.document.querySelector("#checked").checked, false);
  assert.equal(f.document.querySelector("#text").value, "Мой текст");
  assert.equal(f.form.done.size, 2);
  f.document.querySelector("#price").value = "99";
  f.form.protect(f.document.querySelector("#price"));
  await f.form.tick();
  assert.equal(f.document.querySelector("#price").value, "99");
  f.window.happyDOM.abort();
});
test("category guard prevents filling the wrong form and navigation does not loop", async () => {
  const f = await fixture(
    '<button id="category">Квартиры</button><input id="price">',
    [{ field: "price", selector: "#price", action: "text", value: 100 }],
    {
      ready: [{ selector: "#rental" }],
      setup: [{ selector: "#category", action: "click", text: "Квартиры" }],
    },
  );
  let clicks = 0;
  f.document.querySelector("#category").onclick = () => clicks++;
  await f.form.tick();
  await f.form.tick();
  await f.form.tick();
  assert.equal(clicks, 1);
  assert.equal(f.document.querySelector("#price").value, "");
  f.window.happyDOM.abort();
});
test("address selection never chooses an ambiguous first result and waits for its parent", async () => {
  const f = await fixture(
    '<input id="city"><input id="street"><div role="option">Минск</div><div role="option">Минск</div>',
    [
      {
        field: "city",
        selector: "#city",
        action: "autocomplete",
        value: "Минск",
      },
      {
        field: "street",
        selector: "#street",
        action: "autocomplete",
        value: "Ленина",
        after: "city",
      },
    ],
  );
  let clicks = 0;
  for (const e of f.document.querySelectorAll("[role=option]"))
    e.onclick = () => clicks++;
  await f.form.tick();
  await f.form.tick();
  assert.equal(clicks, 0);
  assert.equal(f.document.querySelector("#street").value, "");
  f.document.querySelector("[role=option]").remove();
  await f.form.tick();
  assert.equal(clicks, 1);
  assert.equal(f.document.querySelector("#street").value, "Ленина");
  f.window.happyDOM.abort();
});
test("native option values and displayed chip labels use the server mapping", async () => {
  const f = await fixture(
    '<label><input type="radio" name="rooms" value="2_rooms">2</label><div id="chips"><button aria-pressed="false">Лоджия</button></div>',
    [
      {
        field: "rooms",
        selector: 'input[name="rooms"]',
        action: "choices",
        value: "2_rooms",
      },
      {
        field: "balcony",
        selector: "#chips",
        action: "choices",
        value: "loggia",
        labels: { loggia: "Лоджия" },
      },
    ],
  );
  f.document.querySelector("button").onclick = (e) =>
    e.currentTarget.setAttribute("aria-pressed", "true");
  await f.form.tick();
  assert.equal(f.form.done.size, 2);
  await f.form.tick();
  assert.equal(f.document.querySelector("input").checked, true);
  f.window.happyDOM.abort();
});
test("positive total prevents automated payment while zero does not", async () => {
  const f = await fixture("<p>К оплате: 9,9 р.</p>", []);
  assert.equal(f.window.AutopostRentalForm.paymentRequired(), true);
  f.document.querySelector("p").textContent = "К оплате: 0 р.";
  assert.equal(f.window.AutopostRentalForm.paymentRequired(), false);
  f.window.happyDOM.abort();
});
test("final submission requires automatic mode and a server check without issues", async () => {
  const cases = [
    { mode: "assist", dataReady: true, submit: false },
    { mode: "automatic", dataReady: undefined, submit: false },
    { mode: "automatic", dataReady: false, submit: false },
    { mode: "automatic", dataReady: true, submit: true },
  ];
  for (const { mode, dataReady, submit } of cases) {
    const { handle, created, sent, app } = worker();
    const p = payload();
    p.mode = mode;
    p.jobs = [recipe("kufar")];
    if (dataReady !== undefined) p.jobs[0].dataReady = dataReady;
    await handle(
      { kind: "RENTAL_REQUEST", type: "RENTAL_RUN", payload: p, userGesture: true },
      app,
    );
    const sender = { url: core.starts.kufar, tab: { id: created[0].id } };
    const { task } = await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender);
    assert.equal(task.autoSubmit, submit, `${mode} / ${dataReady}`);
    assert.equal(Object.hasOwn(task, "mode"), false);
    const before = await handle(
      { kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" },
      sender,
    );
    assert.equal(before.ok, submit, `${mode} / ${dataReady}`);
    assert.equal(
      sent.some((s) => s.message.kind === "RENTAL_VERIFY"),
      submit,
      "the app is asked to verify only an allowed submission",
    );
  }
});
async function page(task, wake) {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "https://www.kufar.by/ain/create" });
  window.document.body.innerHTML =
    '<input id="title"><button type="submit">Подать объявление</button>';
  const requests = [],
    intervals = [];
  let listener;
  let submitted = 0;
  window.document.querySelector("button").onclick = () => submitted++;
  window.setInterval = (callback) => intervals.push(callback);
  window.clearInterval = () => {};
  window.AutopostCore = { fillNavigation: () => ({ type: "navigate", referrer: "" }) };
  window.chrome = {
    runtime: {
      id: "extension",
      async sendMessage({ type, payload }) {
        requests.push(type);
        if (type === "GET")
          return payload?.metadataOnly
            ? { task: { jobId: task.jobId, submitted: false } }
            : { task: structuredClone(task) };
        return { ok: true };
      },
      onMessage: { addListener: (callback) => (listener = callback) },
    },
  };
  for (const script of ["rental-autocomplete.js", "rental-form.js", "rental-page.js"])
    window.eval(fs.readFileSync(path.join(__dirname, "..", script), "utf8"));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  const ticks = async (count) => {
    for (let i = 0; i < count; i++) {
      intervals.at(-1)();
      await settle();
    }
  };
  await settle();
  await ticks(6);
  if (wake) {
    listener({ kind: "RENTAL_WAKE", jobId: task.jobId, ...wake }, { id: "extension" }, () => {});
    await settle();
    await ticks(6);
  }
  const result = {
    filled: window.document.querySelector("#title").value,
    beforeSubmit: requests.filter((type) => type === "BEFORE_SUBMIT").length,
    submitted,
  };
  window.happyDOM.abort();
  return result;
}
test("rental page clicks the final button only for an allowed automatic submission", async () => {
  const task = {
    jobId: "job",
    photos: [],
    submitted: false,
    photoSent: false,
    recipe: {
      platform: "kufar",
      ready: [],
      setup: [],
      next: [],
      submit: [{ action: "click", selector: "button", text: "Подать объявление" }],
      controls: [{ field: "title", selector: "#title", action: "text", value: "Квартира" }],
    },
  };
  for (const blocked of [
    { autoSubmit: false },
    { mode: "automatic" },
    { mode: "automatic", recipe: { ...task.recipe, dataReady: true } },
  ]) {
    const result = await page({ ...task, ...blocked });
    assert.equal(result.filled, "Квартира");
    assert.deepEqual([result.beforeSubmit, result.submitted], [0, 0], JSON.stringify(blocked));
  }
  const allowed = await page({ ...task, autoSubmit: true });
  assert.deepEqual([allowed.beforeSubmit, allowed.submitted], [1, 1]);
  const woken = await page({ ...task, autoSubmit: false }, { autoSubmit: true });
  assert.deepEqual([woken.beforeSubmit, woken.submitted], [1, 1]);
  const legacyWake = await page({ ...task, autoSubmit: false }, { mode: "automatic" });
  assert.deepEqual([legacyWake.beforeSubmit, legacyWake.submitted], [0, 0]);
});
