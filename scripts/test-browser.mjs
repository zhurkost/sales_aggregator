import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Runs the production UI, API and unpacked extension in a disposable profile.
// Marketplace fixture routing belongs solely to this test process.
const root = path.resolve(import.meta.dirname, "..");
const origin = "http://localhost:5173";
const live = process.argv.includes("--live");
const output = path.join(root, "work", "browser-tests");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, "run-"));
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const apiOrigin = "http://127.0.0.1:" + port;
// Resolve the actual JVM so Windows launcher shims cannot leave a child API running.
const runtime = spawnSync("java", ["-XshowSettings:properties", "-version"], {encoding:"utf8", windowsHide:true});
const javaHome = runtime.stderr?.match(/java\.home\s*=\s*([^\r\n]+)/)?.[1].trim();
assert.ok(javaHome, "Java 17+ must be available");
const api = spawn(path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"),
  ["-jar", path.join(root, "backend/target/autopost-api.jar")], {
  cwd: root, windowsHide: true,
  env: { ...process.env, PORT: String(port), PUBLIC_ORIGIN: origin,
    DATA_DIR: scratch, CATEGORY_REFERENCE_DIR: path.join(root, "data/rental"),
    VPS_PROXY_SECRET: "", AI_API_KEY: "", DADATA_API_KEY: "", DADATA_RELAY_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", chunk => { apiLog += chunk; });
api.stderr.on("data", chunk => { apiLog += chunk; });
const exit = once(api, "exit");
let browser;
let completed = false;
const results = [];
async function until(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message);
}
try {
  await until(async () => {
    if (api.exitCode !== null) throw new Error("Test API failed to start");
    return fetch(apiOrigin + "/healthz").then(r => r.ok).catch(() => false);
  }, "Test API startup timeout", 30000);
  const extension = path.join(root, "extension");
  browser = await chromium.launchPersistentContext(path.join(scratch, "chrome"), {
    channel: "chromium", headless: true, locale: "ru-RU",
    viewport: {width: 1400, height: 1100},
    args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
  });
  await browser.route(origin + "/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      const response = await browser.request.fetch(apiOrigin + url.pathname + url.search, {
        method: route.request().method(), headers: route.request().headers(),
        data: route.request().postDataBuffer() ?? undefined,
      });
      return route.fulfill({ response });
    }
    const file = path.resolve(root, "dist-angular/browser", "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    assert.ok(file.startsWith(path.join(root, "dist-angular/browser") + path.sep));
    const type = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml"}[path.extname(file)];
    return route.fulfill({ body: await readFile(file), contentType: type ?? "application/octet-stream" });
  });
  if (!live) await browser.route("https://r.onliner.by/pk/apartments/create**", route =>
    route.fulfill({path:path.join(root, "tests/browser/onliner-sale.html"), contentType:"text/html"}));
  if (!live) await browser.route("https://content.onliner.by/**", route => route.fulfill({
    body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"),
    contentType:"image/png",
  }));
  const page = await browser.newPage();
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
  const jobs = () => worker.evaluate(async () => {
    const stored = await chrome.storage.session.get("autopost-rental-jobs-v1");
    return (stored["autopost-rental-jobs-v1"] || []).flatMap(batch => batch.jobs);
  });
  await page.goto(origin);
  await page.getByLabel("Логин", {exact:true}).fill("browser-qa");
  await page.getByLabel("Пароль", {exact:true}).fill("Disposable-test-pass-812");
  await page.getByLabel("Имя профиля", {exact:true}).fill("Проверка продажи");
  await page.getByRole("button", {name:"Создать и войти"}).click();
  await page.getByRole("tab", {name:"Продажа квартир"}).click();
  await page.getByRole("heading", {name:"Продать квартиру", exact:true}).waitFor();
  await page.reload();
  await page.getByRole("heading", {name:"Продать квартиру", exact:true}).waitFor();
  assert.equal(await page.getByRole("tab", {name:"Продажа квартир"}).getAttribute("aria-selected"), "true");
  results.push("Sale tab survives a full browser reload and session restoration");
  await page.getByRole("tab", {name:"Продажа квартир"}).press("ArrowLeft");
  await page.reload();
  await page.getByRole("heading", {name:"Сдать квартиру", exact:true}).waitFor();
  results.push("Keyboard selection of rental tab also survives reload");
  await page.getByRole("tab", {name:"Продажа квартир"}).click();
  await page.getByRole("heading", {name:"Продать квартиру", exact:true}).waitFor();
  await until(() => page.getByRole("button", {name:"Помощник подключён", exact:true}).isVisible(),
    "Real extension did not connect");
  const input = id => page.locator('[id="rental-' + id + '"]');
  const description = "Продам квартиру в Бресте. Цена 245000 BYN. Площадь 72 м², жилая 44 м², кухня 11 м². Этаж 6 из 9. Дом 2012 года. Проверка формы.";
  await input("listing.description").fill(description);
  for (const [id, value] of Object.entries({
    "sale.price":"245000", "apartment.total_area":"72", "apartment.living_area":"44",
    "apartment.kitchen_area":"11", "apartment.floor":"6", "building.floors":"9", "building.year":"2012",
  })) await input(id).fill(value);
  await input("sale.currency").selectOption("BYN");
  await input("apartment.rooms").selectOption("3");
  await input("building.wall").selectOption({label:"Панельный"});
  await input("apartment.balcony").selectOption({label:"Лоджия"});
  await input("apartment.market").selectOption({label:"Вторичка"});
  await page.getByRole("button", {name:"Ввести вручную", exact:true}).click();
  await page.getByLabel("Населённый пункт", {exact:true}).fill("Брест");
  if (!live) {
    for (const site of ["Domovita", "Kufar", "Realt"])
      await page.getByRole("checkbox", {name:site, exact:true}).uncheck();
  } else {
    await page.getByLabel("Улица", {exact:true}).fill("Машерова");
    await page.getByLabel("Дом, включая букву", {exact:true}).fill("10");
  }
  const imagePage = await browser.newPage();
  await imagePage.setContent('<body style="margin:0;background:#dde7f2"><h1>Автопост — тестовое фото</h1>');
  const photo = await imagePage.screenshot({clip:{x:0,y:0,width:800,height:600}});
  await imagePage.close();
  await page.locator('input[type=file]').setInputFiles({name:"browser-qa.png", mimeType:"image/png", buffer:photo});
  await page.bringToFront();
  await page.getByRole("button", {name:"Опубликовать", exact:true}).click();
  if (live) {
    await until(async () => (await jobs()).length === 4, "Four marketplace jobs were not created");
    for (const job of await jobs()) {
      assert.equal(job.recipe.submit.length, 0, "Live checks must stop before publication");
      const host = new URL(job.recipe.startUrl).hostname;
      await until(() => browser.pages().some(p => new URL(p.url()).hostname === host ||
        (host === "r.onliner.by" && new URL(p.url()).hostname === "profile.onliner.by")),
        "Marketplace navigation timed out: " + host, 30000);
      const tab = browser.pages().find(p => new URL(p.url()).hostname === host ||
        (host === "r.onliner.by" && new URL(p.url()).hostname === "profile.onliner.by"));
      if (!tab) throw new Error("Missing marketplace tab " + host);
      await tab.bringToFront();
      const needsLogin = new URL(tab.url()).hostname === "profile.onliner.by";
      if (!needsLogin) {
        let previous = "", stableSince = Date.now();
        await until(async () => {
          const status = (await jobs()).find(j => j.id === job.id);
          const current = JSON.stringify([status?.status, status?.filled, status?.remaining, status?.message]);
          if (current !== previous) { previous = current; stableSince = Date.now(); }
          // A dependent address field can wait six ticks before later controls run.
          return status?.status === "needs_action" && Date.now() - stableSince > 12000;
        }, "Live marketplace did not settle: " + host, 110000).catch(error => {
          results.push(error.message);
        });
      }
      const status = (await jobs()).find(j => j.id === job.id);
      const observed = await tab.evaluate(controls => controls.map(c => {
        let elements = [...document.querySelectorAll(c.selector)];
        if (c.headingSelector) elements = elements.filter(el =>
          [...el.querySelectorAll(c.headingSelector)].some(h => h.textContent.trim() === c.heading));
        return {field:c.field, action:c.action, expected:c.value,
          observed:elements.map(el => ({value:el.value,
            text:(el.tagName === "IFRAME" ? el.contentDocument?.body.innerText : el.innerText)?.slice(0,300),
            checked:el.checked, visible:!!el.getClientRects().length,
            selected:[...el.querySelectorAll('input:checked,[aria-checked="true"],[aria-selected="true"]')]
              .map(choice => ({value:choice.value, label:(choice.closest("label") || choice).textContent.trim()}))
          })).slice(0,8)};
      }), job.recipe.controls);
      const visibleText = await tab.locator("body").innerText();
      const photos = await tab.evaluate(controls => controls.filter(c => c.action === "files").map(c => ({
        field:c.field,
        counter:c.uploadedCountSelector ? [...document.querySelectorAll(c.uploadedCountSelector)].map(el => el.textContent) : [],
        previews:c.previewSelector ? document.querySelectorAll(c.previewSelector).length : null,
        inputs:[...document.querySelectorAll(c.selector)].map(el => ({tag:el.tagName, files:el.files?.length})),
      })), job.recipe.controls);
      await writeFile(path.join(output, "live-" + job.recipe.platform + ".json"),
        JSON.stringify({url:tab.url(), needsLogin, status, observed, photos, visibleText}, null, 2));
      await tab.screenshot({path:path.join(output, "live-" + job.recipe.platform + ".png")});
      const message = job.recipe.platform + ": " + (needsLogin ? "login required" : status?.message) +
        "; remaining=" + JSON.stringify(status?.remaining || []);
      results.push(message);
      console.log(message);
    }
  } else {
  await until(() => browser.pages().some(p => new URL(p.url()).hostname.endsWith("onliner.by")),
    "Application did not launch the sale marketplace");
  const marketplace = browser.pages().find(p => new URL(p.url()).hostname.endsWith("onliner.by"));
  // Chromium does not intercept the first document of a chrome.tabs.create tab.
  // Load the routed fixture before that unauthenticated page consumes the pending job.
  await marketplace.goto("https://r.onliner.by/pk/apartments/create");
  await marketplace.bringToFront();
  await until(async () => await marketplace.evaluate(() => window.uploads) === 1, "Photo was not uploaded");
  await until(async () => await marketplace.locator(".new-photos__thumbnail-figure").count() === 1,
    "Restored photo was not replaced");
  // Wait for the helper to pause on fields hidden on the next step.
  await until(async () => (await jobs()).some(job => job.status === "needs_action"),
    "Helper did not pause at the end of the photo step", 25000);
  await marketplace.getByRole("link", {name:"Продолжить", exact:true}).click();
  await until(async () => await marketplace.locator('[name="area.total"]').inputValue() === "72",
    "Helper did not resume after the manual step change");
  await until(async () => await marketplace.locator("#price-input").inputValue() === "245000",
    "Price did not settle after currency selection");
  const expected = {"floor":"6","floors":"9","area.total":"72","area.living":"44","area.kitchen":"11","buildingYear":"2012"};
  for (const [name, value] of Object.entries(expected))
    assert.equal(await marketplace.locator('[name="' + name + '"]').inputValue(), value, name);
  assert.equal(await marketplace.locator("#price-input").inputValue(), "245000");
  assert.equal(await marketplace.locator('select').inputValue(), "BYN");
  assert.equal(await marketplace.locator("textarea").inputValue(), description);
  assert.equal(await marketplace.locator('[name=rooms]:checked').inputValue(), "3");
  assert.equal(await marketplace.locator("#submitted").textContent(), "0");
  results.push("UI → backend mapping → real extension → sale form, price, currency, areas and photo replacement");
  await marketplace.locator('[name="area.total"]').fill("73");
  const devtools = await browser.newCDPSession(marketplace);
  const tree = await devtools.send("Accessibility.getFullAXTree");
  const retry = tree.nodes.find(node => node.role?.value === "button" && node.name?.value === "Повторить заполнение");
  assert.ok(retry?.backendDOMNodeId, "Helper retry button is accessible");
  const box = await devtools.send("DOM.getBoxModel", {backendNodeId:retry.backendDOMNodeId});
  const corners = box.model.border;
  await marketplace.mouse.click((corners[0] + corners[2]) / 2, (corners[1] + corners[5]) / 2);
  await until(async () => (await jobs()).some(job => job.status === "running"), "Retry did not start");
  await until(async () => (await jobs()).some(job => job.status === "needs_action"), "Retry did not settle");
  assert.equal(await marketplace.locator('[name="area.total"]').inputValue(), "73");
  results.push("Manual change survives a repeat fill");
  await marketplace.reload();
  // Content scripts run at document_idle, which can follow the load event.
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(await marketplace.locator('[name="area.total"]').inputValue(), "56");
  assert.equal(await marketplace.locator("#autopost-rental-helper").count(), 0);
  assert.equal(await marketplace.evaluate(() => window.uploads), 0);
  results.push("Browser reload does not restart automatic filling");
  }
  await page.bringToFront();
  await page.screenshot({path:path.join(output, "sale-cabinet.png"), fullPage:true});
  completed = true;
  console.log(results.join("\n"));
} catch (error) {
  for (const [index, page] of (browser?.pages() || []).entries()) {
    await page.screenshot({path:path.join(output, "failure-" + index + ".png"), fullPage:true}).catch(() => {});
    await writeFile(path.join(output, "failure-" + index + ".html"), await page.content()).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(path.join(output, live ? "live-report.json" : "report.json"),
    JSON.stringify({mode:live ? "live-anonymous-observation" : "onliner-fixture", completed, results}, null, 2));
  await writeFile(path.join(scratch, "api.log"), apiLog);
  await browser?.close();
  api.kill();
  await exit;
}
