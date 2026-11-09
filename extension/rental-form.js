(function (root) {
  "use strict";
  const norm = (v) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е");
  const restoredSaleNumbers = new Set([
    "onliner.floor", "onliner.floors", "onliner.area.total", "onliner.area.living",
    "onliner.area.kitchen", "onliner.wallHeight", "onliner.buildingYear",
  ]);
  const visible = (e) =>
    !!e &&
    !e.closest('[hidden],[aria-hidden="true"]') &&
    getComputedStyle(e).display !== "none" &&
    getComputedStyle(e).visibility !== "hidden" &&
    (e.getClientRects().length > 0 ||
      e.ownerDocument.defaultView?.navigator?.userAgent?.includes("HappyDOM"));
  const enabled = (e) =>
    !e.disabled &&
    e.getAttribute("aria-disabled") !== "true" &&
    !/\b\S*[_-]disabled\b/.test(e.className || "");
  const label = (e) => e.closest('label') || e.labels?.[0] || e.closest('[role="checkbox"],[role="radio"]') || e;
  function query(selector, scope = document) {
    try {
      return [...scope.querySelectorAll(selector)].filter(
        (e) => !e.closest("#autopost-rental-helper"),
      );
    } catch {
      return [];
    }
  }
  function renderedChoice(c, e) {
    if (visible(e) || visible(label(e))) return true;
    // Domovita mounts inactive mobile sections and hides them with CSS visibility.
    const wrapper = e.closest("label");
    return c.mountedChoice && wrapper && !wrapper.closest("[hidden]") &&
      wrapper.getBoundingClientRect().width > 0;
  }
  function controlRows(c, scope = document) {
    let rows = query(c.selector, scope);
    if (c.controlText) rows = rows.filter(e => norm((e.innerText || e.textContent).split("\n")[0]) === norm(c.controlText));
    if (c.headingSelector) rows = rows.filter(e => query(c.headingSelector, e).some(h => norm(h.textContent) === norm(c.heading)));
    if (c.index !== undefined) rows = rows[c.index] ? [rows[c.index]] : [];
    return rows;
  }
  function targets(c, scope = document) {
    return controlRows(c, scope).filter(
      (e) =>
        (visible(e) ||
          (c.action === "files" && e.type === "file") ||
          (c.action === "choices" && renderedChoice(c, e)) ||
          (["checkbox", "radio"].includes(e.type) && visible(label(e)))) &&
        enabled(e),
    );
  }
  function events(e) {
    for (const type of ["input", "change", "keyup", "blur"])
      e.dispatchEvent(
        type === "keyup"
          ? new KeyboardEvent(type, { bubbles: true })
          : new Event(type, { bubbles: true }),
      );
  }
  function setText(e, value) {
    const proto =
      e.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : e.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(
      e,
      String(value),
    );
    events(e);
  }
  function editorText(container) {
    const copy = container.cloneNode(true);
    for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
    return [...copy.childNodes].map(node => node.textContent).join("");
  }
  function selected(e) {
    return (
      e.checked === true ||
      ["true"].includes(e.getAttribute("aria-pressed")) ||
      e.getAttribute("aria-selected") === "true" ||
      e.getAttribute("aria-checked") === "true" ||
      e.getAttribute("data-state") === "checked" ||
      /(?:^|[\s_\-])(?:selected|active|checked)(?:[\s_\-]|$)/i.test(
        e.className || "",
      ) ||
      String(e.className || "").includes("text-white bg-basic") ||
      String(e.className || "").includes("chip__filled-green")
    );
  }
  function choiceScope(c, container) {
    if (!c.label) return container;
    const labels = query("label,p,span,div", container).filter(
      (e) => norm(e.textContent) === norm(c.label),
    );
    for (const l of labels) {
      let p = l.parentElement;
      for (
        let i = 0;
        i < 3 && p && container.contains(p);
        i++, p = p.parentElement
      )
        if (query('[role="button"],button,input', p).length) return p;
    }
    return null;
  }
  class Form {
    constructor(recipe, photos = [], claimPhotos = async () => true) {
      this.recipe = recipe;
      this.photos = photos;
      this.claimPhotos = claimPhotos;
      this.done = new Set();
      this.tried = new Set();
      this.pending = new Map();
      this.protected = new Set();
      this.progress = 0;
      this.photoSent = false;
      this.stepClicks = new Set();
      this.waiting = null;
    }
    ready() {
      if (this.recipe.formPath && location.pathname.replace(/\/$/, "") !== this.recipe.formPath) return false;
      return (this.recipe.ready || []).every((r) => {
        const exists = query(r.selector).some(
          (e) =>
            (visible(e) || visible(label(e))) &&
            (!r.text || norm(e.textContent).includes(norm(r.text))),
        );
        return r.absent ? !exists : exists;
      });
    }
    clickControl(element) {
      // Native checkbox activation emits a trusted input event even for element.click().
      this.activating = true;
      try { element.click(); } finally { this.activating = false; }
    }
    protect(target) {
      if (this.activating) return;
      for (const c of this.recipe.controls)
        if (
          controlRows(c).some(
            (e) =>
              e === target || e.contains(target) || label(e).contains(target),
          )
        )
          this.protected.add(c.field);
    }
    async fill(c) {
      if (this.done.has(c.field) || this.protected.has(c.field)) return;
      if (c.after && !this.done.has(c.after)) return;
      if (c.blockedSelector && query(c.blockedSelector).some(visible)) return;
      const hasCounter = c.uploadedCountSelector || c.previewSelector;
      const uploadedCount = () => {
        if (c.previewSelector) return query(c.previewSelector).length;
        const counters = query(c.uploadedCountSelector).filter(visible);
        return counters.length === 1
          ? Number(counters[0].textContent.match(/\d+/)?.[0] ?? NaN) : NaN;
      };
      if (c.action === "files" && c.previewSelector && this.oldPreviews && this.photoExpected) {
        const current = query(c.previewSelector);
        if (!this.replacementReady) {
          const remainingOld = new Map(this.oldPreviews);
          let added = 0;
          for (const photo of current) {
            const src = photo.querySelector("img").src;
            const count = remainingOld.get(src) || 0;
            if (count) remainingOld.set(src, count - 1);
            else added++;
          }
          if (added !== this.photoExpected) return;
          this.replacementReady = true;
        }
        if (current.length > this.photoExpected) {
          const old = current.find(photo => this.oldPreviews.has(photo.querySelector("img").src));
          if (!old) return;
          const remove = old.querySelector(".new-photos__thumbnail-remove");
          if (remove && !this.removedPreviews.has(old)) {
            this.removedPreviews.add(old);
            this.clickControl(remove);
            this.progress++;
          }
          return;
        }
      }
      if (c.action === "files" && hasCounter && this.photoSent) {
        if (this.photoExpected && uploadedCount() === this.photoExpected)
          this.done.add(c.field);
        return;
      }
      if (c.expandSection) {
        const section = document.getElementById(c.expandSection);
        const sibling = section?.nextElementSibling;
        const buttons = section ? query('button', section) : [];
        if (sibling?.matches('button')) buttons.push(sibling);
        const expand = buttons.find(b => visible(b) && norm(b.textContent) === 'все параметры');
        if (expand) { this.clickControl(expand); this.progress++; return; }
      }
      if (c.pickerId) return this.fillRealtPicker(c);
      const elements = targets(c);
      if (!elements.length) return;
      const value = c.value,
        values = Array.isArray(value) ? value : [value];
      if (c.action === "files") {
        if (!this.photos.length || this.photoSent) return;
        // Existing uploads belong to the user; do not append duplicates or claim success.
        if (["onliner.images", "onliner.file"].includes(c.field) && c.previewSelector) {
          // Replace restored thumbnails only once all the incoming uploads appeared.
          this.oldPreviews = new Map();
          for (const photo of query(c.previewSelector)) {
            const src = photo.querySelector("img").src;
            this.oldPreviews.set(src, (this.oldPreviews.get(src) || 0) + 1);
          }
          this.removedPreviews = new Set();
        } else if (hasCounter && uploadedCount() > 0) {
          this.protected.add(c.field);
          return;
        }
        if (elements.length !== 1 || (!this.oldPreviews && elements[0].files?.length)) return;
        const transfer = new DataTransfer();
        for (const p of this.photos) {
          const [header, data] = p.dataUrl.split(",");
          const bytes = Uint8Array.from(atob(data), (x) => x.charCodeAt(0));
          transfer.items.add(
            new File([bytes], p.name, { type: header.slice(5).split(";")[0] }),
          );
        }
        if (!(await this.claimPhotos())) {
          this.photoSent = true;
          return;
        }
        elements[0].files = transfer.files;
        this.photoSent = true;
        this.photoExpected = this.photos.length;
        events(elements[0]);
        // Some uploaders clear or replace the input as soon as they accept the files.
        if (hasCounter ? !this.oldPreviews?.size && uploadedCount() === this.photoExpected
            : elements[0].files.length === this.photos.length) {
          this.done.add(c.field);
        }
        return;
      }
      if (
        value === null ||
        value === undefined ||
        (value === "" && !c.emptyChoice) ||
        (Array.isArray(value) && !value.length && !c.replaceGroup)
      )
        return;
      if (
        ["text", "richtext", "check", "select", "autocomplete"].includes(
          c.action,
        )
      ) {
        if (elements.length !== 1) return;
        const target = elements[0];
        const e = c.action === "richtext" && target.tagName === "IFRAME" ? target.contentDocument?.body : target;
        if (!e || (target !== e && !e.isContentEditable)) return;
        if (c.action === "check") {
          const desired = c.checkedValue !== undefined ? String(value) === c.checkedValue : value === true || value === "true";
          const state = () => typeof e.checked === "boolean" ? e.checked : e.getAttribute("aria-checked") === "true";
          if (state() !== desired) this.clickControl(e);
          if (state() === desired) this.done.add(c.field);
          return;
        }
        if (c.action === "select") {
          const option = [...e.options].filter(
            (o) =>
              String(o.value) === String(value) ||
              norm(o.textContent) === norm(c.labels?.[value] || value),
          );
          if (option.length === 1) {
            setText(e, option[0].value);
            if (e.value === option[0].value) this.done.add(c.field);
          }
          return;
        }
        if (c.action === "richtext") {
          const expected = editorText(new DOMParser().parseFromString(String(value), "text/html").body);
          const current = norm(editorText(e));
          if (current && current !== norm(expected)) {
            this.protected.add(c.field);
            return;
          }
          if (!current) {
            const p = e.ownerDocument.createElement("p");
            expected.split("\n").forEach((line, i) => {
              if (i) p.append(e.ownerDocument.createElement("br"));
              p.append(line);
            });
            e.replaceChildren(p);
            events(e);
          }
          if (norm(editorText(e)) === norm(expected)) this.done.add(c.field);
          return;
        }
        const current = e.value;
        if (c.action === "autocomplete") {
          root.AutopostRentalAutocomplete.fill(this, c, e, {
            query,
            visible,
            enabled,
          });
          return;
        }
        if (c.action === "text" && /phone/.test(c.field)) {
          const digits = (v) => String(v ?? "").replace(/\D/g, "");
          const national = (v) => digits(v).replace(/^375(?=\d{9}$)/, "");
          const existing = digits(current);
          // A country-code mask is an empty phone, not a user-entered number.
          if (existing && existing !== "375" && national(current) !== national(value)) {
            this.protected.add(c.field);
            return;
          }
          if (existing !== "375" && existing && national(current) === national(value)) {
            this.done.add(c.field);
            return;
          }
          const fixedPrefix = [...(e.parentElement?.children || [])].some(
            (n) => n !== e && norm(n.textContent) === "+375",
          );
          const target = fixedPrefix ? national(value) : value;
          setText(e, target);
          if (national(e.value) === national(value)) this.done.add(c.field);
          return;
        }
        const onlinerPrice = ["onliner.price_amount", "onliner.price.amount"].includes(c.field);
        const equivalent = (a, b) => {
          if (!onlinerPrice) return norm(a) === norm(b);
          const number = v => Number(String(v).replace(/\s/g, "").replace(",", "."));
          return String(a).trim() !== "" && number(a) === number(b);
        };
        const replaceRestored = c.field === "onliner.description" || onlinerPrice ||
          (this.recipe.formPath === "/pk/apartments/create" && restoredSaleNumbers.has(c.field));
        if (current && !equivalent(current, value) && !replaceRestored) {
          this.protected.add(c.field);
          return;
        }
        // Onliner's BYN mask treats a dot as a grouping separator.
        const inputValue = onlinerPrice && e.placeholder.includes(",")
          ? String(value).replace(".", ",") : value;
        setText(e, inputValue);
        if (equivalent(e.value, value)) this.done.add(c.field);
        else if (["realt.house_number", "realt.location.houseNumber"].includes(c.field) && e.value !== current) {
          // Realt may strip a house suffix. Leave the original value for manual review.
          setText(e, current);
          this.protected.add(c.field);
        }
        return;
      }
      if (c.replaceGroup) {
        const wanted = new Set(values.map(String));
        const stale = elements.find(e => e.type === "checkbox" && e.checked && !wanted.has(e.value));
        if (stale) {
          this.clickControl(stale);
          if (!stale.checked) this.progress++;
          return;
        }
      }
      let all = true;
      for (const v of values) {
        const want = norm(c.uiLabels?.[v] ?? c.labels?.[v] ?? v);
        const key = c.field + ":" + String(v);
        if (
          c.displaySelector &&
          elements.some((e) =>
            query(c.displaySelector, e).some(
              (n) => norm(n.textContent) === want,
            ),
          )
        )
          continue;
        let candidates = [];
        for (const rootEl of elements) {
          const scope = choiceScope(c, rootEl);
          if (!scope) continue;
          const inputs = scope.matches("input")
            ? [scope]
            : query('input[type="radio"],input[type="checkbox"]', scope);
          const matchingInputs = inputs.filter(
              (e) =>
                (String(e.value) === String(v) || norm(label(e).textContent) === want) &&
                enabled(e) && renderedChoice(c, e),
            );
          candidates.push(...matchingInputs);
          if (!matchingInputs.length)
            candidates.push(
              ...query(
                'button,[role="button"],[role="option"],[role="checkbox"],[role="radio"],label',
                scope,
              ).filter((e) => norm(e.textContent) === want),
            );
        }
        candidates = [...new Set(candidates)].filter(
          (e) => enabled(e) && renderedChoice(c, e),
        );
        // A label nested in a clickable chip is one choice, not two matches.
        candidates = candidates.filter((e) => !candidates.some(
          (other) => other !== e && other.contains(e),
        ));
        if (!candidates.length && c.action === "dropdown") {
          const options = query(c.optionsSelector || '[role="option"]').filter(
            (e) => visible(e) && norm(e.textContent) === want,
          );
          candidates.push(...options);
          if (
            !options.length &&
            !this.tried.has(c.field + ":open") &&
            elements.length === 1
          ) {
            const trigger =
              query(
                c.triggerSelector ||
                  'input,button,[role="button"],[role="combobox"]',
                elements[0],
              )[0] || elements[0];
            if (c.triggerEvent === "mousedown") {
              trigger.dispatchEvent(new MouseEvent("mousedown", {
                bubbles: true, cancelable: true, button: 0, buttons: 1,
              }));
              trigger.dispatchEvent(new MouseEvent("mouseup", {
                bubbles: true, cancelable: true, button: 0,
              }));
            } else trigger.click();
            this.tried.add(c.field + ":open");
            this.waiting = { field: c.field, tries: 0 };
            // React renders the menu after this event. Opening it for the next
            // selected value in the same tick would immediately close it again.
            return;
          }
        }
        if (candidates.length !== 1) {
          all = false;
          continue;
        }
        const e = candidates[0];
        if (selected(e)) {
          continue;
        }
        if (this.tried.has(key)) {
          all = false;
          continue;
        }
        this.clickControl(e);
        this.tried.add(key);
        this.progress++;
        // Let the site's render finish before the next choice. Synchronous clicks
        // can share stale React state and overwrite an earlier selection.
        return;
      }
      if (all) this.done.add(c.field);
    }
    fillRealtPicker(c) {
      if (this.picker && this.picker.field !== c.field) return;
      const section = document.querySelector(c.selector);
      if (!section) return;
      const wanted = c.value.map(String);
      const options = () => wanted.map(id => document.getElementById(id))
        .filter(e => e?.matches('input[type="checkbox"][name="option"]') && visible(label(e)));
      if (!this.picker) {
        if (this.tried.has(c.field + ":picker")) return;
        const desktop = document.getElementById(c.pickerId);
        const mobile = query('[role="button"]', section).find(e =>
          visible(e) && norm(e.firstElementChild?.textContent) === norm(c.label));
        const opener = desktop && visible(desktop) ? desktop : mobile;
        if (!opener) return;
        this.tried.add(c.field + ":picker");
        this.picker = {field:c.field, attempts:0};
        if (opener === desktop) opener.focus();
        this.clickControl(opener);
        this.progress++;
        return;
      }
      const items = options();
      if (items.length === wanted.length && items.length) {
        const missing = items.find(e => !e.checked);
        if (!missing) {
          // Mobile edits are staged in a sheet. Only apply this option list.
          let scope = items[0].parentElement;
          let apply;
          while (scope && scope !== document.body && !apply) {
            apply = query('button', scope).find(e => visible(e) && norm(e.textContent) === "применить");
            scope = scope.parentElement;
          }
          if (apply) this.clickControl(apply);
          else items[0].dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
          this.done.add(c.field);
          this.picker = null;
          return;
        }
        if (!this.tried.has(c.field + ":" + missing.id)) {
          this.tried.add(c.field + ":" + missing.id);
          this.clickControl(missing);
          this.progress++;
          return;
        }
      }
      if (++this.picker.attempts < 6) this.progress++;
      else this.picker = null;
    }
    clickStep(phase) {
      for (const s of this.recipe[phase] || []) {
        const key =
          phase +
          ":" +
          s.selector +
          ":" +
          s.text +
          ":" +
          (s.stepSelector
            ? query(s.stepSelector)
                .map((e) => e.textContent)
                .join("|")
            : "");
        if (this.stepClicks.has(key)) continue;
        const els = targets(s).filter(
          (e) => s.matchText === false || norm(e.textContent) === norm(s.text),
        );
        if (
          els.length === 1 &&
          !selected(els[0]) &&
          !els[0].querySelector("input:checked")
        ) {
          this.stepClicks.add(key);
          els[0].click();
          return true;
        }
      }
      return false;
    }
    declinePaidDefault() {
      if (this.recipe.platform !== "kufar" || this.promotionHandled) return;
      const chosen = query('[data-cy^="vas-"][class*="card--selected"]').filter(visible);
      if (chosen.length !== 1 || chosen[0].dataset.cy === "vas-no_vas") return;
      const free = query('[data-cy="vas-no_vas"]').filter(e =>
        visible(e) && norm(e.textContent) === "без увеличения просмотров");
      if (free.length === 1) {
        this.promotionHandled = true;
        this.clickControl(free[0]);
      }
    }
    async tick() {
      const before = this.done.size;
      const beforeProgress = this.progress;
      // Choose category before touching any values in a potentially unrelated form.
      if (!this.ready()) {
        // Kufar may ask for the address before showing the deal selector.
        if (this.recipe.addressBeforeDeal && this.recipe.platform === "kufar" &&
            query('[data-testid="name_selected_category"]').some(e => visible(e) && norm(e.textContent).includes(norm(this.recipe.addressCategoryText || "Квартиры"))) &&
            !query('[data-testid="kufar-chose-category-popup"],[data-name="type"]').some(visible)) {
          const address = this.recipe.controls.find(c => c.action === "autocomplete" && c.addressPart === "label");
          if (address) await this.fill(address);
          return this.progress !== beforeProgress;
        }
        if (this.clickStep("setup")) return true;
        return false;
      }
      this.declinePaidDefault();
      if (this.waiting) {
        const c = this.recipe.controls.find(
          (c) => c.field === this.waiting.field,
        );
        if (c) await this.fill(c);
        // Address lookups are asynchronous. Filling a sibling too early can blur
        // React Select and erase our query. Manual edits release the queue at once.
        const expired = this.waiting.until !== undefined
          ? Date.now() >= this.waiting.until : ++this.waiting.tries >= 6;
        if (this.done.has(this.waiting.field) || this.protected.has(this.waiting.field) || expired)
          this.waiting = null;
        else return true;
      }
      for (const c of this.recipe.controls) {
        await this.fill(c);
        // React controls may re-render their siblings after a click.
        if (this.waiting || (this.recipe.oneChangePerTick && this.progress !== beforeProgress)) break;
      }
      return this.done.size > before || this.progress > beforeProgress;
    }
    awaitingPhotos() {
      return !!this.photoExpected && this.recipe.controls.some(c =>
        c.action === "files" && (c.uploadedCountSelector || c.previewSelector) && !this.done.has(c.field));
    }
    remaining() {
      return this.recipe.controls
        .filter(
          (c) =>
            !this.done.has(c.field) &&
            (c.action !== "files" || this.photos.length || c.value?.length),
        )
        .map((c) => c.name || c.field)
        .concat(this.recipe.unbound || []);
    }
    blockedReason() {
      return this.recipe.controls.find(c => !this.done.has(c.field) &&
        !this.protected.has(c.field) &&
        (c.action !== "files" || this.photos.length && !this.photoSent) &&
        c.blockedSelector && query(c.blockedSelector).some(visible))?.blockedMessage || "";
    }
  }
  root.AutopostRentalForm = { Form, visible };
  if (typeof module !== "undefined") module.exports = root.AutopostRentalForm;
})(globalThis);
