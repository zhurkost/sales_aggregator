const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const recipe = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../data/rental/apartments_long_term_rent/runtime/browser_realt.json",
    ),
    "utf8",
  ),
);
const field = (id, value) => ({
  ...recipe.controls.find((c) => c.field === "realt." + id),
  value,
});
const cityRows = `<li><div role="button"><p>г. <span>Минск</span></p><p>Минский р-н, Минская область</p></div></li>
  <li><div role="button"><p>с/т. Минский Водник</p><p>Логойский р-н, Минская область</p></div></li>`;
// Reduced markup observed in the authenticated form on 2026-11-03. No account data.
async function setup(rows = cityRows, city = field("settlement", "г Минск")) {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "https://realt.by/podat-obyavlenie/" }),
    document = window.document;
  document.body.innerHTML = `<div class="relative" id="city-wrap"><label>Адрес</label><div class="relative"><input id="location.settlement"></div><div><ul>${rows}</ul></div></div>
    <div class="relative" id="street-wrap"><div class="relative"><input id="location.street" disabled></div><div><ul>
    <li><div role="button">Ольшевского пер.</div></li><li><div role="button"><span>Ольшевского</span> ул.</div></li>
    <li><div role="button">Добавить: Ольшевского</div></li></ul></div></div><input id="location.houseNumber" disabled>
    <ul><li><div role="button"><p>г. Минск</p></div></li></ul>`;
  for (const script of ["rental-autocomplete.js", "rental-form.js"])
    window.eval(fs.readFileSync(path.join(__dirname, "..", script), "utf8"));
  const controls = [
    city,
    field("street", "ул Ольшевского"),
    field("house_number", "27"),
  ];
  const form = new window.AutopostRentalForm.Form({ controls, ready: [] });
  return {
    window,
    document,
    form,
    city: document.getElementById("location.settlement"),
    street: document.getElementById("location.street"),
    house: document.getElementById("location.houseNumber"),
  };
}
test("Realt selects first city and first street of the requested type, waits for confirmation, then fills house", async (t) => {
  const f = await setup();
  t.after(() => f.window.happyDOM.abort());
  let cityClicks = 0,
    streetClicks = 0,
    wrongClicks = 0;
  for (const row of f.document.querySelectorAll('[role="button"]'))
    row.onclick = () => wrongClicks++;
  const city = f.document.querySelector('#city-wrap [role="button"]');
  city.onclick = () => {
    cityClicks++;
    f.city.value = "г. Минск, Минский р-н, Минская область";
    f.document.querySelector("#city-wrap ul").remove();
    f.street.disabled = false;
    f.house.disabled = false;
  };
  f.document.querySelectorAll('#street-wrap [role="button"]')[1].onclick =
    () => {
      streetClicks++;
      f.street.value = "Ольшевского ул.";
      f.document.querySelector("#street-wrap ul").remove();
    };
  await f.form.tick();
  assert.equal(f.document.activeElement, f.city);
  assert.equal(f.city.value, "минск");
  await f.form.tick();
  await f.form.tick();
  assert.equal(cityClicks, 1);
  assert.equal(f.form.done.has("realt.settlement"), false);
  assert.equal(f.street.value, "");
  await f.form.tick();
  assert.equal(f.form.done.has("realt.settlement"), true);
  assert.equal(f.street.value, "ольшевского");
  for (let i = 0; i < 4; i++) await f.form.tick();
  assert.equal(streetClicks, 1);
  assert.equal(wrongClicks, 0);
  assert.equal(f.house.value, "27");
  assert.equal(f.form.done.size, 3);
});
test("an add-new action alone is not an address suggestion", async (t) => {
  const f = await setup();
  t.after(() => f.window.happyDOM.abort());
  f.form.done.add("realt.settlement");
  f.street.disabled = false;
  f.form.recipe.controls[1].value = "Ольшевского";
  for (const row of [...f.document.querySelectorAll("#street-wrap li")].slice(0, 2)) row.remove();
  let clicks = 0;
  for (const b of f.document.querySelectorAll('[role="button"]'))
    b.onclick = () => clicks++;
  for (let i = 0; i < 10; i++) await f.form.tick();
  assert.equal(clicks, 0);
  assert.equal(f.form.done.has("realt.street"), false);
});

test("a later matching type outranks the first suggestion", async (t) => {
  const f = await setup();
  t.after(() => f.window.happyDOM.abort());
  f.form.done.add("realt.settlement");
  f.street.disabled = false;
  Object.assign(f.form.recipe.controls[1], {value: "Ольшевского", streetType: "ул"});
  let correct = 0, wrong = 0;
  const buttons = f.document.querySelectorAll('#street-wrap [role="button"]');
  buttons[0].onclick = () => wrong++;
  buttons[1].onclick = () => correct++;
  buttons[2].onclick = () => wrong++;
  for (let i = 0; i < 4; i++) await f.form.tick();
  assert.equal(f.street.value, "ольшевского");
  assert.equal(correct, 1);
  assert.equal(wrong, 0);
});
test("duplicate settlements use the first row after loading", async (t) => {
  const row =
    '<li><div role="button"><p>д. Лесная</p><p>Ивацевичский р-н, Брестская область</p></div></li>';
  const f = await setup(
    row +
      '<li><div role="button"><p>д. Лесная</p><p>Минский р-н, Минская область</p></div></li>',
    field("settlement", "д Лесная"),
  );
  t.after(() => f.window.happyDOM.abort());
  let clicks = 0;
  for (const b of f.document.querySelectorAll('#city-wrap [role="button"]'))
    b.onclick = () => { assert.match(b.textContent, /Брестская/); clicks++; };
  f.form.recipe.controls[0].matchContext = [
    "Минская обл",
    "Минский район",
  ];
  const spinner = f.document.createElement("svg");
  spinner.classList.add("animate-spin");
  f.city.parentElement.append(spinner);
  for (let i = 0; i < 3; i++) await f.form.tick();
  assert.equal(clicks, 0);
  spinner.remove();
  await f.form.tick();
  await f.form.tick();
  assert.equal(clicks, 1);
  assert.equal(f.form.pending.get("realt.settlement").label, "д. Лесная");
});
test("a dropped click does not confirm a city or repeatedly click it", async (t) => {
  const f = await setup();
  t.after(() => f.window.happyDOM.abort());
  let clicks = 0;
  f.document.querySelector('#city-wrap [role="button"]').onclick = () =>
    clicks++;
  for (let i = 0; i < 14; i++) await f.form.tick();
  assert.equal(clicks, 1);
  assert.equal(f.form.done.size, 0);
  assert.equal(f.street.value, "");
});
test("manual edits during autocomplete are preserved", async (t) => {
  const f = await setup();
  t.after(() => f.window.happyDOM.abort());
  await f.form.tick();
  f.city.value = "Брест";
  f.form.protect(f.city);
  for (let i = 0; i < 10; i++) await f.form.tick();
  assert.equal(f.city.value, "Брест");
  assert.equal(f.form.done.size, 0);
});
