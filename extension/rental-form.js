(function (root) {
  "use strict";
  const norm = (v) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("ru");
  const visible = (e) =>
    !!e &&
    !e.closest('[hidden],[aria-hidden="true"]') &&
    getComputedStyle(e).display !== "none" &&
    getComputedStyle(e).visibility !== "hidden" &&
    e.getClientRects().length > 0;
  const enabled = (e) =>
    !e.disabled &&
    e.getAttribute("aria-disabled") !== "true" &&
    !/\b\S*[_-]disabled\b/.test(e.className || "");
  const label = (e) => e.labels?.[0] || e.closest("label") || e;
  function query(selector, scope = document) {
    try {
      return [...scope.querySelectorAll(selector)].filter(
        (e) => !e.closest("#autopost-rental-helper"),
      );
    } catch {
      return [];
    }
  }
  function targets(c, scope = document) {
    let rows = query(c.selector, scope);
    if (c.index !== undefined) rows = rows[c.index] ? [rows[c.index]] : [];
    return rows.filter(
      (e) =>
        (visible(e) ||
          (c.action === "files" && e.type === "file") ||
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
  // The server prepares rich text as escaped HTML: one <p> per paragraph and <br>
  // per line break. Entities are decoded by the HTML parser, never by a regex.
  // Other tags are not produced: they are dropped (script/style with content).
  function htmlText(html) {
    const body = new DOMParser().parseFromString(String(html), "text/html").body;
    const paragraphs = [];
    let current = "";
    const end = () => {
      if (current.trim()) paragraphs.push(current);
      current = "";
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) current += child.data;
        else if (child.nodeType !== Node.ELEMENT_NODE) continue;
        else if (child.nodeName === "BR") current += "\n";
        else if (child.nodeName === "P") {
          end();
          walk(child);
          end();
        } else if (!/^(?:SCRIPT|STYLE|TEMPLATE)$/.test(child.nodeName)) walk(child);
      }
    };
    walk(body);
    end();
    return paragraphs.join("\n\n");
  }
  // Editor text with block and <br> boundaries as line breaks.
  function editorText(e) {
    let text = "";
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.data;
        else if (child.nodeType !== Node.ELEMENT_NODE) continue;
        else if (child.nodeName === "BR") text += "\n";
        else {
          const block = /^(?:P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(child.nodeName);
          if (block) text += "\n";
          walk(child);
          if (block) text += "\n";
        }
      }
    };
    walk(e);
    return text;
  }
  // Rich editors turn every pasted line into a paragraph, so blank lines are not compared.
  const lines = (text) =>
    String(text).split("\n").map(norm).filter(Boolean).join("\n");
  // Insert like a user paste so TipTap/ProseMirror updates its own document state.
  function pasteText(e, text) {
    const doc = e.ownerDocument,
      before = editorText(e);
    e.focus();
    const range = doc.createRange(),
      selection = doc.getSelection();
    range.selectNodeContents(e);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const data = new DataTransfer();
    data.setData("text/plain", text);
    e.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (editorText(e) === before) doc.execCommand?.("insertText", false, text);
  }
  function selected(e) {
    return (
      e.checked === true ||
      ["true"].includes(e.getAttribute("aria-pressed")) ||
      e.getAttribute("aria-selected") === "true" ||
      e.getAttribute("data-state") === "checked" ||
      /(?:^|[\s_\-])(?:selected|active|checked)(?:[\s_\-]|$)/i.test(
        e.className || "",
      ) ||
      String(e.className || "").includes("text-white bg-basic") ||
      String(e.className || "").includes("chip__filled-green")
    );
  }
  function paymentRequired() {
    return query('p,[role="alert"]')
      .filter(visible)
      .some((e) => {
        const match = e.textContent.match(
          /(?:к оплате|итого|оплатить)\s*:?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)/i,
        );
        return (
          match && Number(match[1].replace(/\s/g, "").replace(",", ".")) > 0
        );
      });
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
      return (this.recipe.ready || []).every((r) => {
        const exists = query(r.selector).some(
          (e) =>
            (visible(e) || visible(label(e))) &&
            (!r.text || norm(e.textContent).includes(norm(r.text))),
        );
        return r.absent ? !exists : exists;
      });
    }
    protect(target) {
      for (const c of this.recipe.controls)
        if (
          query(c.selector).some(
            (e) =>
              e === target || e.contains(target) || label(e).contains(target),
          )
        )
          this.protected.add(c.field);
    }
    async fill(c) {
      if (this.done.has(c.field) || this.protected.has(c.field)) return;
      if (c.after && !this.done.has(c.after)) return;
      const elements = targets(c);
      if (!elements.length) return;
      const value = c.value,
        values = Array.isArray(value) ? value : [value];
      if (c.action === "files") {
        if (!this.photos.length || this.photoSent) return;
        if (elements.length !== 1 || elements[0].files?.length) return;
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
        events(elements[0]);
        if (elements[0].files.length === this.photos.length) {
          this.done.add(c.field);
          this.photoSent = true;
        }
        return;
      }
      if (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && !value.length)
      )
        return;
      if (
        ["text", "richtext", "check", "select", "autocomplete"].includes(
          c.action,
        )
      ) {
        if (elements.length !== 1) return;
        const e = elements[0];
        if (c.action === "check") {
          const desired = value === true || value === "true";
          if (e.checked !== desired) e.click();
          if (e.checked === desired) this.done.add(c.field);
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
          const text = htmlText(value),
            current = lines(editorText(e));
          if (current && current !== lines(text)) {
            this.protected.add(c.field);
            return;
          }
          if (!current) pasteText(e, text);
          if (lines(editorText(e)) === lines(text)) this.done.add(c.field);
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
        if (current && norm(current) !== norm(value)) {
          this.protected.add(c.field);
          return;
        }
        setText(e, value);
        if (norm(e.value) === norm(value)) this.done.add(c.field);
        return;
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
          candidates.push(
            ...inputs.filter(
              (e) =>
                String(e.value) === String(v) ||
                norm(label(e).textContent) === want,
            ),
          );
          if (!inputs.length)
            candidates.push(
              ...query(
                'button,[role="button"],[role="option"],label',
                scope,
              ).filter((e) => norm(e.textContent) === want),
            );
        }
        candidates = [...new Set(candidates)].filter(
          (e) => enabled(e) && (visible(e) || visible(label(e))),
        );
        if (!candidates.length && c.action === "dropdown") {
          const options = query(c.optionsSelector || '[role="option"]').filter(
            (e) => visible(e) && norm(e.textContent) === want,
          );
          candidates.push(...options);
          if (
            !options.length &&
            !this.tried.has(key + ":open") &&
            elements.length === 1
          ) {
            const trigger =
              query(
                c.triggerSelector ||
                  'input,button,[role="button"],[role="combobox"]',
                elements[0],
              )[0] || elements[0];
            trigger.click();
            this.tried.add(key + ":open");
            this.waiting = { field: c.field, tries: 0 };
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
        e.click();
        this.tried.add(key);
        if (!selected(e)) all = false;
      }
      if (all) this.done.add(c.field);
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
    async tick() {
      const before = this.done.size;
      // Choose category before touching any values in a potentially unrelated form.
      if (!this.ready()) {
        if (this.clickStep("setup")) return true;
        return false;
      }
      if (this.waiting) {
        const c = this.recipe.controls.find(
          (c) => c.field === this.waiting.field,
        );
        if (c) await this.fill(c);
        if (this.done.has(this.waiting.field) || ++this.waiting.tries >= 6)
          this.waiting = null;
        else return true;
      }
      for (const c of this.recipe.controls) {
        await this.fill(c);
        if (this.waiting) break;
      }
      return this.done.size > before;
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
  }
  root.AutopostRentalForm = { Form, targets, norm, visible, paymentRequired };
  if (typeof module !== "undefined") module.exports = root.AutopostRentalForm;
})(globalThis);
