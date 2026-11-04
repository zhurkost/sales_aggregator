const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const core = require("../rental-core.js");
const layout = require("./layout.cjs");
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
const RULES = "a".repeat(64);
// A job as extension-config compiles it: the recipe and the server's publication record.
const job = (p, publication = "publication-" + p) => ({ ...recipe(p), publication });
const payload = () => ({
  id: "card",
  profileId: "owner",
  revision: 1,
  integrationVersion: RULES,
  mode: "automatic",
  jobs: Object.keys(core.starts).map((p) => job(p)),
  photos: [],
});
test("rental launch accepts partial cards for all four sites, independent of advisory readiness", () => {
  const p = payload();
  p.jobs.forEach((j) => (j.controls = []));
  const result = core.validate(p);
  assert.equal(result.jobs.length, 4);
  assert.equal(result.jobs[0].publication, "publication-kufar");
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
test("rental jobs accept only a boolean checksPassed from the server", () => {
  for (const checksPassed of [true, false, undefined]) {
    const p = payload();
    p.jobs[0].checksPassed = checksPassed;
    assert.equal(core.validate(p).jobs[0].checksPassed, checksPassed);
  }
  for (const checksPassed of ["true", 1, null, {}]) {
    const p = payload();
    p.jobs[0].checksPassed = checksPassed;
    assert.throws(() => core.validate(p), /Обновите правила площадки/);
  }
});
test("every rental job carries the server's record of its publication", () => {
  for (const publication of [undefined, "", 7, "../drafts", "x".repeat(121)]) {
    const p = payload();
    p.jobs[1].publication = publication;
    assert.throws(() => core.validate(p), /Обновите правила площадки/, String(publication));
  }
});
test("rental launch carries the integration version the server compiled its jobs with", () => {
  assert.equal(core.validate(payload()).integrationVersion, RULES);
  for (const integrationVersion of [undefined, "", 7, "<script>", "x".repeat(121)]) {
    const p = payload();
    p.integrationVersion = integrationVersion;
    assert.throws(() => core.validate(p), /Обновите правила площадки/, String(integrationVersion));
  }
});
function worker() {
  const data = {},
    created = [],
    photos = new Map(),
    sent = [];
  const state = { verify: { ok: true }, report: { ok: true } };
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
        if (state.unreachable?.has(tabId)) throw new Error("Receiving end does not exist.");
        return message.kind === "RENTAL_REPORT" && message.status !== "submitted"
          ? state.report
          : state.verify;
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
      p.jobs.forEach((j) => (j.checksPassed = true));
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
  const window = layout(new Window({ url: "https://www.kufar.by/ain/create" }));
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
// Same escaping as the server's plain_text_html conversion (RuleExecutor).
const serverHtml = (text) =>
  "<p>" +
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br>") +
  "</p>";
const description =
  'Сдам "уютную" квартиру & место для авто <script>alert(1)</script>\n\nВторой абзац\nс переносом';
const editor =
  '<div class="tiptap" contenteditable="true"><p><br class="ProseMirror-trailingBreak"></p></div>';
// ProseMirror's plain-text paste: every line becomes a paragraph, text is never parsed as HTML.
function proseMirror(document, pasted = []) {
  const e = document.querySelector(".tiptap");
  e.addEventListener("paste", (event) => {
    const text = event.clipboardData.getData("text/plain");
    pasted.push(text);
    event.preventDefault();
    e.replaceChildren(
      ...text.split(/(?:\r\n?|\n)+/).map((line) => {
        const p = document.createElement("p");
        p.textContent = line;
        return p;
      }),
    );
  });
  return { e, pasted };
}
const richtext = (value) => [
  { field: "description", selector: ".tiptap[contenteditable=\"true\"]", action: "richtext", index: 0, value },
];
test("rich text description is pasted as plain text with decoded entities and line breaks", async () => {
  const f = await fixture(editor, richtext(serverHtml(description)));
  const { e, pasted } = proseMirror(f.document);
  await f.form.tick();
  assert.deepEqual(pasted, [description]);
  assert.deepEqual(
    [...e.querySelectorAll("p")].map((p) => p.textContent),
    ['Сдам "уютную" квартиру & место для авто <script>alert(1)</script>', "Второй абзац", "с переносом"],
  );
  assert.equal(e.querySelector("script"), null);
  assert.doesNotMatch(e.textContent, /&amp;|&quot;|&lt;/);
  assert.equal(f.form.done.has("description"), true);
  f.window.happyDOM.abort();
});
test("rich text falls back to insertText and drops tags the server never sends", async () => {
  const f = await fixture(editor, richtext("<p>Текст <b>жирный</b><script>bad()</script></p><p>Абзац</p>"));
  const e = f.document.querySelector(".tiptap"),
    commands = [];
  f.document.execCommand = (command, ui, text) => {
    commands.push([command, text]);
    e.innerHTML = text.split("\n").filter(Boolean).map(() => "<p></p>").join("");
    text.split("\n").filter(Boolean).forEach((line, i) => (e.children[i].textContent = line));
    return true;
  };
  await f.form.tick();
  assert.deepEqual(commands, [["insertText", "Текст жирный\n\nАбзац"]]);
  assert.equal(f.form.done.has("description"), true);
  f.window.happyDOM.abort();
});
test("rich text never replaces a description the user already wrote or is editing", async () => {
  const own = await fixture(
    '<div class="tiptap" contenteditable="true"><p>Мой текст</p></div>',
    richtext(serverHtml(description)),
  );
  const first = proseMirror(own.document);
  await own.form.tick();
  assert.deepEqual(first.pasted, []);
  assert.equal(first.e.textContent, "Мой текст");
  assert.equal(own.form.done.has("description"), false);
  own.window.happyDOM.abort();
  const typing = await fixture(editor, richtext(serverHtml(description)));
  const second = proseMirror(typing.document);
  typing.form.protect(second.e.querySelector("p"));
  await typing.form.tick();
  assert.deepEqual(second.pasted, []);
  typing.window.happyDOM.abort();
});
// TinyMCE as observed on Realt (live check 2026-11-04): a hidden source textarea and a
// same-origin iframe without src whose body is the editable root. happy-dom gives a
// contentDocument only to srcdoc frames; the extension reads contentDocument either way.
const tinymce = (body = '<p><br data-mce-bogus="1"></p>') =>
  '<textarea id="description.description" style="display:none" aria-hidden="true"></textarea>' +
  '<iframe id="description.description_ifr" class="tox-edit-area__iframe" srcdoc="' +
  '<body id=&quot;tinymce&quot; class=&quot;mce-content-body&quot; contenteditable=&quot;true&quot;' +
  ' data-id=&quot;description.description&quot;>' +
  body.replace(/"/g, "&quot;") +
  '</body>"></iframe>';
const iframeRichtext = (value) => [
  { field: "realt.description", selector: '[id="description.description_ifr"]', action: "iframe_richtext", value },
];
async function frameFixture(html, value) {
  const f = await fixture(html, iframeRichtext(value));
  await f.window.happyDOM.waitUntilComplete();
  const frame = f.document.querySelector("iframe");
  return { ...f, frame, body: frame.contentDocument?.body };
}
// TinyMCE's plain-text paste: one paragraph per line, the text is never parsed as HTML.
function tinymcePaste(body, pasted = []) {
  body.addEventListener("paste", (event) => {
    const text = event.clipboardData.getData("text/plain");
    pasted.push(text);
    event.preventDefault();
    body.replaceChildren(
      ...text.split(/\n+/).map((line) => {
        const p = body.ownerDocument.createElement("p");
        p.textContent = line;
        return p;
      }),
    );
  });
  return pasted;
}
test("iframe rich text is pasted into the editor body of a same-origin frame", async () => {
  const f = await frameFixture(tinymce(), serverHtml(description));
  assert.ok(f.body, "the synthetic frame has a document");
  const pasted = tinymcePaste(f.body);
  await f.form.tick();
  assert.deepEqual(pasted, [description]);
  assert.deepEqual(
    [...f.body.querySelectorAll("p")].map((p) => p.textContent),
    ['Сдам "уютную" квартиру & место для авто <script>alert(1)</script>', "Второй абзац", "с переносом"],
  );
  assert.equal(f.body.querySelector("script"), null);
  assert.equal(f.form.done.has("realt.description"), true);
  // The hidden source textarea belongs to TinyMCE and is never written.
  assert.equal(f.document.querySelector("textarea").value, "");
  f.window.happyDOM.abort();
});
test("iframe rich text falls back to insertText in the frame's own document", async () => {
  const f = await frameFixture(tinymce(), "<p>Первый</p><p>Второй</p>");
  const commands = [];
  f.body.ownerDocument.execCommand = (command, ui, text) => {
    commands.push([command, text]);
    f.body.innerHTML = text.split("\n").filter(Boolean).map((line) => `<p>${line}</p>`).join("");
    return true;
  };
  await f.form.tick();
  assert.deepEqual(commands, [["insertText", "Первый\n\nВторой"]]);
  assert.equal(f.form.done.has("realt.description"), true);
  f.window.happyDOM.abort();
});
test("iframe rich text keeps the user's own text and skips frames it cannot edit", async () => {
  const own = await frameFixture(tinymce("<p>Мой текст</p>"), serverHtml(description));
  const pasted = tinymcePaste(own.body);
  await own.form.tick();
  assert.deepEqual(pasted, []);
  assert.equal(own.body.textContent, "Мой текст");
  assert.equal(own.form.done.has("realt.description"), false);
  own.window.happyDOM.abort();
  // No document (another origin, or not loaded yet) and a body that is not editable.
  for (const html of [
    '<iframe id="description.description_ifr"></iframe>',
    '<iframe id="description.description_ifr" srcdoc="<body><p>Просмотр</p></body>"></iframe>',
  ]) {
    const f = await frameFixture(html, serverHtml(description));
    await f.form.tick();
    assert.equal(f.form.done.has("realt.description"), false, html);
    if (f.body) assert.equal(f.body.textContent, "Просмотр");
    f.window.happyDOM.abort();
  }
});
test("Realt recipe fills the title and the TinyMCE description seen on the live form", async () => {
  const controls = recipe("realt").controls.filter((c) =>
    ["realt.title", "realt.description"].includes(c.field),
  );
  assert.deepEqual(controls.map((c) => c.action), ["text", "iframe_richtext"]);
  const values = { "realt.title": "Двухкомнатная у метро", "realt.description": serverHtml(description) };
  const f = await fixture(
    '<input type="text" id="description.title" maxlength="255">' + tinymce(),
    controls.map((c) => ({ ...c, value: values[c.field] })),
  );
  await f.window.happyDOM.waitUntilComplete();
  const pasted = tinymcePaste(f.document.querySelector("iframe").contentDocument.body);
  await f.form.tick();
  assert.equal(f.document.getElementById("description.title").value, "Двухкомнатная у метро");
  assert.deepEqual(pasted, [description]);
  assert.deepEqual([...f.form.done].sort(), ["realt.description", "realt.title"]);
  f.window.happyDOM.abort();
});
test("rental recipes may use the iframe rich text action", () => {
  const p = payload();
  p.jobs[2].controls = iframeRichtext("<p>Текст</p>");
  assert.equal(core.validate(p).jobs[2].controls[0].action, "iframe_richtext");
  p.jobs[2].controls[0].action = "iframe_script";
  assert.throws(() => core.validate(p), /Неизвестное правило заполнения/);
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
    { mode: "assist", checks: { checksPassed: true }, submit: false },
    { mode: "automatic", checks: {}, submit: false },
    { mode: "automatic", checks: { checksPassed: false }, submit: false },
    // The former name of the flag no longer allows anything.
    { mode: "automatic", checks: { dataReady: true }, submit: false },
    { mode: "automatic", checks: { checksPassed: true }, submit: true },
  ];
  for (const { mode, checks, submit } of cases) {
    const { handle, created, sent, app } = worker();
    const p = payload();
    p.mode = mode;
    p.jobs = [{ ...job("kufar"), ...checks }];
    const label = `${mode} / ${JSON.stringify(checks)}`;
    await handle(
      { kind: "RENTAL_REQUEST", type: "RENTAL_RUN", payload: p, userGesture: true },
      app,
    );
    const sender = { url: core.starts.kufar, tab: { id: created[0].id } };
    const { task } = await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender);
    assert.equal(task.autoSubmit, submit, label);
    assert.equal(Object.hasOwn(task, "mode"), false);
    const before = await handle(
      { kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" },
      sender,
    );
    assert.equal(before.ok, submit, label);
    assert.equal(
      sent.some((s) => s.message.status === "submitted"),
      submit,
      "the server is asked only for an allowed submission",
    );
  }
});
test("the final click is allowed by the server's record of the launched publication", async () => {
  const { handle, created, sent, app } = worker();
  const launch = (integrationVersion, publication) => {
    const p = payload();
    p.integrationVersion = integrationVersion;
    p.jobs = [{ ...job("kufar", publication), checksPassed: true }];
    return handle(
      { kind: "RENTAL_REQUEST", type: "RENTAL_RUN", payload: p, userGesture: true },
      app,
    );
  };
  const verified = async () => {
    const sender = { url: core.starts.kufar, tab: { id: created.at(-1).id } };
    await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender);
    assert.equal((await handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender)).ok, true);
    return sent.filter((s) => s.message.status === "submitted").at(-1);
  };
  await launch(RULES, "first-launch");
  assert.equal(created.length, 1);
  const first = await verified();
  // The server compares the revision and the rules of the launch it recorded.
  assert.equal(first.tabId, app.tab.id);
  assert.deepEqual({ ...first.message }, {
    kind: "RENTAL_REPORT",
    origin: new URL(app.url).origin,
    profileId: "owner",
    publication: "first-launch",
    status: "submitted",
    message: "Выполнена попытка подачи. Проверьте результат и сообщения площадки.",
  });
  // The worker keeps no copy of the card for this check.
  assert.equal(sent.some((s) => "draft" in s.message), false);
  // Same card revision under new rules: a new launch, never a resume of jobs filled by old ones.
  await assert.rejects(() => launch("b".repeat(64), "second-launch"), /Остановите предыдущий запуск/);
  await handle(
    { kind: "RENTAL_REQUEST", type: "RENTAL_STOP", payload: { profileId: "owner", id: "card" }, userGesture: true },
    app,
  );
  // The submitted publication is not reported stopped: a submission is never undone.
  assert.equal(sent.some((s) => s.message.publication === "first-launch" && s.message.status === "stopped"), false);
  await launch("b".repeat(64), "second-launch");
  assert.equal(created.length, 2);
  assert.equal((await verified()).message.publication, "second-launch");
});
test("a refused submission is not clicked and an unreachable Autopost tab is not a permission", async () => {
  const { handle, created, state, app } = worker();
  const p = payload();
  p.jobs = [{ ...job("kufar"), checksPassed: true }];
  await handle({ kind: "RENTAL_REQUEST", type: "RENTAL_RUN", payload: p, userGesture: true }, app);
  const sender = { url: core.starts.kufar, tab: { id: created[0].id } };
  await handle({ kind: "RENTAL_PAGE", type: "GET" }, sender);
  state.verify = { error: "Карточка изменена. Остановите старый запуск и передайте новую версию." };
  await assert.rejects(
    () => handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender),
    /Карточка изменена/,
  );
  state.verify = { ok: true };
  state.unreachable = new Set([app.tab.id]);
  await assert.rejects(
    () => handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender),
    /Откройте Автопост для сверки карточки/,
  );
  state.unreachable = new Set();
  assert.equal((await handle({ kind: "RENTAL_PAGE", type: "BEFORE_SUBMIT" }, sender)).ok, true);
});
test("the worker reports each job's publication to the server through the Autopost tab", async () => {
  const { handle, created, sent, state, app } = worker();
  const reports = () =>
    sent
      .filter((s) => s.message.kind === "RENTAL_REPORT")
      .map((s) => [s.message.publication, s.message.status, s.message.message]);
  const p = payload();
  p.jobs = [job("kufar"), job("realt")];
  await handle({ kind: "RENTAL_REQUEST", type: "RENTAL_RUN", payload: p, userGesture: true }, app);
  assert.deepEqual(reports(), [
    ["publication-kufar", "opened", "Заполняем карточку"],
    ["publication-realt", "opened", "Заполняем карточку"],
  ]);
  const kufar = { url: core.starts.kufar, tab: { id: created[0].id } };
  await handle({ kind: "RENTAL_PAGE", type: "GET" }, kufar);
  const report = (status, message) =>
    handle({ kind: "RENTAL_PAGE", type: "REPORT", payload: { status, message, filled: 3 } }, kufar);
  // Filling progress stays in the browser; the server keeps where the publication stands.
  await report("running", "Перенесено полей: 3");
  await report("filled", "Заполненные данные перенесены. Завершите шаг площадки.");
  await report("filled", "Заполненные данные перенесены. Завершите шаг площадки.");
  await report("needs_action", "Пройдите вход или проверку площадки, затем продолжим.");
  assert.deepEqual(reports().slice(2), [
    ["publication-kufar", "filled", "Заполненные данные перенесены. Завершите шаг площадки."],
    ["publication-kufar", "needs_action", "Пройдите вход или проверку площадки, затем продолжим."],
  ]);
  // The Autopost tab of the launch is gone: the report waits for the card's next status request.
  state.unreachable = new Set([app.tab.id]);
  await report("filled", "Заполненные данные перенесены. Завершите шаг площадки.");
  const other = { url: app.url, tab: { id: 2 } };
  const status = () =>
    handle({ kind: "RENTAL_REQUEST", type: "RENTAL_STATUS", payload: { profileId: "owner", id: "card" } }, other);
  await status();
  assert.deepEqual(sent.at(-1).tabId, 2);
  assert.deepEqual(reports().at(-1), ["publication-kufar", "filled", "Заполненные данные перенесены. Завершите шаг площадки."]);
  const delivered = sent.length;
  await status();
  assert.equal(sent.length, delivered, "a delivered report is not sent again");
  // A report the server refuses (e.g. after a submission) is not retried.
  state.report = { error: "Подача на эту площадку уже выполнена." };
  await report("needs_action", "Форма изменилась.");
  state.report = { ok: true };
  await status();
  assert.equal(sent.length, delivered + 1);
  await handle(
    { kind: "RENTAL_REQUEST", type: "RENTAL_STOP", payload: { profileId: "owner", id: "card" }, userGesture: true },
    other,
  );
  assert.deepEqual(reports().slice(-2), [
    ["publication-kufar", "stopped", "Остановлено в Автопосте"],
    ["publication-realt", "stopped", "Остановлено в Автопосте"],
  ]);
  // Resuming the stopped launch opens its publications again.
  await handle({ kind: "RENTAL_REQUEST", type: "RENTAL_RUN", payload: p, userGesture: true }, other);
  assert.deepEqual(reports().slice(-2), [
    ["publication-kufar", "opened", "Возобновляем заполнение"],
    ["publication-realt", "opened", "Возобновляем заполнение"],
  ]);
});
async function page(task, wake, count = 6) {
  const { Window } = await import("happy-dom");
  const window = layout(new Window({ url: "https://www.kufar.by/ain/create" }));
  window.document.body.innerHTML =
    '<input id="title"><button type="submit">Подать объявление</button>';
  const requests = [],
    reports = [],
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
        if (type === "REPORT") reports.push(payload.status);
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
  await ticks(count);
  if (wake) {
    listener({ kind: "RENTAL_WAKE", jobId: task.jobId, ...wake }, { id: "extension" }, () => {});
    await settle();
    await ticks(6);
  }
  const result = {
    filled: window.document.querySelector("#title").value,
    beforeSubmit: requests.filter((type) => type === "BEFORE_SUBMIT").length,
    submitted,
    reports,
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
    { mode: "automatic", recipe: { ...task.recipe, checksPassed: true } },
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
test("a form the extension filled is reported as filled, one it could not fill as needing action", async () => {
  const task = {
    jobId: "job",
    photos: [],
    submitted: false,
    photoSent: false,
    autoSubmit: false,
    recipe: {
      platform: "kufar",
      ready: [],
      setup: [],
      next: [],
      submit: [],
      controls: [{ field: "title", selector: "#title", action: "text", value: "Квартира" }],
    },
  };
  const filled = await page(task, undefined, 12);
  assert.equal(filled.filled, "Квартира");
  assert.equal(filled.reports.at(-1), "filled");
  const missing = await page(
    { ...task, recipe: { ...task.recipe, controls: [{ ...task.recipe.controls[0], selector: "#absent" }] } },
    undefined,
    12,
  );
  assert.equal(missing.reports.at(-1), "needs_action");
});
test("hidden form controls are skipped exactly as a browser without layout reports them", async () => {
  const f = await fixture(
    '<div style="display:none"><input id="hidden-price"></div><div hidden><input id="hidden-area"></div><input id="price">',
    [
      { field: "hidden-price", selector: "#hidden-price", action: "text", value: 10 },
      { field: "hidden-area", selector: "#hidden-area", action: "text", value: 20 },
      { field: "price", selector: "#price", action: "text", value: 30 },
    ],
  );
  await f.form.tick();
  assert.equal(f.document.querySelector("#hidden-price").value, "");
  assert.equal(f.document.querySelector("#hidden-area").value, "");
  assert.equal(f.document.querySelector("#price").value, "30");
  assert.deepEqual([...f.form.done], ["price"]);
  f.window.happyDOM.abort();
});
test("a platform's chosen-chip class comes from its recipe, not from shared code", async () => {
  const chips =
    '<div data-name="rooms"><div role="button" class="styles_chip__filled-green__a1">2</div><div role="button" class="styles_chip__b2">3</div></div>';
  const rooms = { field: "rooms", selector: '[data-name="rooms"]', action: "choices", value: "2" };
  for (const [control, clicks] of [
    [{ ...rooms, selectedClass: "chip__filled-green" }, 0],
    [rooms, 1],
  ]) {
    const f = await fixture(chips, [control]);
    let clicked = 0;
    f.document.querySelector('[role="button"]').onclick = () => clicked++;
    await f.form.tick();
    assert.equal(clicked, clicks, JSON.stringify(control));
    f.window.happyDOM.abort();
  }
  const type = { action: "click", selector: '[data-name="type"] [role="button"]', text: "Долгосрочная аренда" };
  for (const [step, clicks] of [
    [{ ...type, selectedClass: "chip__filled-green" }, 0],
    [type, 1],
  ]) {
    const f = await fixture(
      '<div data-name="type"><div role="button" class="styles_chip__filled-green__a1">Долгосрочная аренда</div></div>',
      [],
      { ready: [{ selector: "#rental-form" }], setup: [step] },
    );
    let clicked = 0;
    f.document.querySelector('[role="button"]').onclick = () => clicked++;
    await f.form.tick();
    assert.equal(clicked, clicks, JSON.stringify(step));
    f.window.happyDOM.abort();
  }
});
test("Kufar recipe marks its chips with the class proven by its ready guard", () => {
  const kufar = recipe("kufar");
  const guard = kufar.ready.find((r) => r.selector.startsWith('[data-name="type"]'));
  assert.match(guard.selector, /\[class\*="chip__filled-green"\]/);
  // Chips only: a radio group (contact method) is chosen by its checked input.
  for (const c of kufar.controls)
    assert.equal(
      c.selectedClass,
      c.action === "choices" && c.selector.startsWith("[data-name=") ? "chip__filled-green" : undefined,
      c.field,
    );
  assert.deepEqual(
    kufar.setup.filter((s) => s.selectedClass).map((s) => s.selector),
    ['[data-name="type"] [role="button"]'],
  );
  for (const p of ["onliner", "domovita"]) {
    const other = recipe(p);
    assert.equal(
      [...other.controls, ...other.setup, ...other.next, ...other.submit].some((r) => r.selectedClass),
      false,
      p,
    );
  }
  for (const bad of ["chip filled", "text-white bg-basic", 'x"]', 5, ""]) {
    const control = payload();
    control.jobs[0].controls[0].selectedClass = bad;
    assert.throws(() => core.validate(control), /Неизвестное правило заполнения/);
    const step = payload();
    step.jobs[0].setup[0].selectedClass = bad;
    assert.throws(() => core.validate(step), /Неизвестный переход формы/);
  }
  assert.doesNotThrow(() => core.validate(payload()));
});
// Chip classes as seen on the live Realt form, 2026-11-04 (research/rental/…/live-check-2026-11-04.md).
const realtChip = "cursor-pointer inline-flex px-4 rounded-md transition-colors m-1 items-center";
const realtChosen = realtChip + " rounded-l-md text-white bg-basic text-subhead py-1.5";
const realtOther = realtChip + " bg-basic-50 text-basic-900 hover:bg-basic-100 text-subhead py-1.5";
test("Realt recipe marks its chosen chips; shared code no longer knows the Realt class", async () => {
  const realt = recipe("realt");
  for (const c of realt.controls)
    assert.equal(c.selectedClass, c.action === "choices" ? "text-white" : undefined, c.field);
  assert.equal([...realt.setup, ...realt.next, ...realt.submit].some((s) => s.selectedClass), false);
  assert.equal(realtOther.includes("text-white"), false);
  const currency = realt.controls.find((c) => c.field === "realt.currency");
  const html = `<div id="termsOfDeal"><div><p>Цена</p><div><div role="button" class="${realtChosen}">BYN</div><div role="button" class="${realtOther}">USD</div></div></div></div>`;
  for (const [control, value, clicks] of [
    [currency, "BYN", [0, 0]],
    [currency, "USD", [0, 1]],
    [{ ...currency, selectedClass: undefined }, "BYN", [1, 0]],
  ]) {
    const f = await fixture(html, [{ ...control, value }]);
    const seen = [0, 0];
    f.document.querySelectorAll('[role="button"]').forEach((e, i) => (e.onclick = () => seen[i]++));
    await f.form.tick();
    assert.deepEqual(seen, clicks, value + " " + JSON.stringify(control.selectedClass));
    f.window.happyDOM.abort();
  }
});
test("Realt recipe fills the additional chips and separate rooms after rooms", async () => {
  const realt = recipe("realt");
  const fields = ["realt.rooms", "realt.separate_rooms", "realt.furniture", "realt.stove", "realt.telephone_lines"];
  const values = {
    "realt.rooms": 2,
    "realt.separate_rooms": 2,
    "realt.furniture": 402,
    "realt.stove": 1,
    "realt.telephone_lines": 0,
  };
  const labels = {
    "realt.rooms": { 2: "2" },
    "realt.furniture": { 1: "есть", 0: "нет", 402: "частично" },
    "realt.stove": { 0: "газ", 1: "плита электрическая" },
    "realt.telephone_lines": { 0: "нет", 1: "есть" },
  };
  const controls = realt.controls
    .filter((c) => fields.includes(c.field))
    .map((c) => ({ ...c, value: values[c.field], labels: labels[c.field] || {} }));
  assert.equal(controls.length, fields.length);
  const chips = (label, options) =>
    `<div><p>${label}</p><div>${options.map((o) => `<div role="button" class="${realtOther}">${o}</div>`).join("")}</div></div>`;
  const f = await fixture(
    `<div id="apartment">${chips("Комнат", ["1", "2", "3"])}<input id="apartment.separateRooms" type="tel" hidden></div>` +
      `<div id="additional">${chips("Мебель", ["Есть", "Нет", "Частично"])}${chips("Плита", ["Газ", "Плита электрическая"])}${chips("Количество телефонов", ["Нет", "Есть"])}</div>`,
    controls,
  );
  const separate = f.document.getElementById("apartment.separateRooms");
  f.document.querySelectorAll('[role="button"]').forEach((e) => {
    e.onclick = () => {
      e.className = realtChosen;
      // Realt shows separate rooms once 2 or more rooms are chosen.
      if (e.textContent === "2") separate.hidden = false;
    };
  });
  await f.form.tick();
  await f.form.tick();
  assert.equal(separate.value, "2");
  const chosen = [...f.document.querySelectorAll('[role="button"]')]
    .filter((e) => e.className.includes("text-white"))
    .map((e) => e.textContent);
  assert.deepEqual(chosen, ["2", "Частично", "Плита электрическая", "Нет"]);
  assert.deepEqual([...f.form.done].sort(), [...fields].sort());
  f.window.happyDOM.abort();
});
test("Kufar recipe chooses the contact method radio from its research report", async () => {
  const control = recipe("kufar").controls.find((c) => c.field === "kufar.contact_method");
  const f = await fixture(
    '<label><input type="radio" name="phone_hidden" value="0">Звонки и сообщения</label>' +
      '<label><input type="radio" name="phone_hidden" value="1">Только сообщения</label>',
    [{ ...control, value: "1", labels: { 0: "Звонки и сообщения", 1: "Только сообщения" } }],
  );
  await f.form.tick();
  const [both, messages] = f.document.querySelectorAll("input");
  assert.equal(both.checked, false);
  assert.equal(messages.checked, true);
  assert.equal(f.form.done.has("kufar.contact_method"), true);
  f.window.happyDOM.abort();
});
