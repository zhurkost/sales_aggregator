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
test("rental worker opens every selected site once and isolates profile, origin and assigned tab", async () => {
  const data = {},
    created = [],
    photos = new Map();
  let verify = { ok: true };
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
      async sendMessage() {
        return verify;
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
    handle = context.AutopostRentalBackground.handle;
  const run = () =>
    handle(
      {
        kind: "RENTAL_REQUEST",
        type: "RENTAL_RUN",
        payload: payload(),
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
  verify = { error: "Карточка изменилась" };
  await assert.rejects(() =>
    handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender),
  );
  verify = { ok: true };
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
