(function (root) {
  "use strict";
  const norm = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("ru").replace(/ё/g, "е");
  const types = {
    settlement: [
      ["город", ["город", "г"]],
      ["деревня", ["деревня", "д"]],
      ["агрогородок", ["агрогородок", "аг"]],
      ["поселок", ["посёлок", "поселок", "пос", "п"]],
      [
        "городской поселок",
        ["городской посёлок", "городской поселок", "г.п", "гп"],
      ],
      ["село", ["село", "с"]],
      ["садовое товарищество", ["садовое товарищество", "с/т", "ст"]],
    ],
    street: [
      ["улица", ["улица", "ул"]],
      ["переулок", ["переулок", "пер"]],
      ["проспект", ["проспект", "пр-т", "пр-кт", "просп", "пр"]],
      ["проезд", ["проезд", "пр-д"]],
      ["бульвар", ["бульвар", "б-р", "бул"]],
      ["площадь", ["площадь", "пл"]],
      ["шоссе", ["шоссе", "ш"]],
      ["набережная", ["набережная", "наб"]],
      ["тракт", ["тракт"]],
      ["тупик", ["тупик", "туп"]],
      ["парк", ["парк"]],
    ],
  };
  function addressName(value, kind) {
    let name = norm(
      kind === "settlement" ? String(value).split(",")[0] : value,
    );
    for (const [type, aliases] of types[kind] || []) {
      for (const alias of aliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const start = new RegExp("^" + escaped + "\\.?\\s+", "i");
        const end = new RegExp("\\s+" + escaped + "\\.?$", "i");
        if (start.test(name) || end.test(name))
          return { name: name.replace(start, "").replace(end, ""), type };
      }
    }
    return { name, type: "" };
  }
  function streetCodes(text) {
    const words = norm(text).replace(/[‑–—]/g, "-").split(/[^\p{L}\d-]+/u);
    return types.street.filter(([, aliases]) => aliases.some(alias => words.includes(alias)))
      .map(([type]) => type.slice(0, 2));
  }

  function kufarSelectedAddress(display, option) {
    // The menu shows "улица Ленина, 12А, Витебск"; the accepted value moves the
    // street type to the end and may append the region.
    const parts = value => String(value).split(",").map(norm);
    const selected = parts(display), clicked = parts(option);
    if (clicked.length < 3 || selected.length < clicked.length) return false;
    const street = addressName(clicked[0], "street");
    const shown = addressName(selected[0], "street");
    if (!street.type || street.type !== shown.type || street.name !== shown.name ||
        !clicked[1] || clicked[1] !== selected[1]) return false;
    // Kufar can insert the rural council between the settlement and district.
    // Verify all selected suggestion components in order, allowing added context.
    let cursor = 2;
    return clicked.slice(2).every(part => {
      const index = part ? selected.indexOf(part, cursor) : -1;
      if (index < 0) return false;
      cursor = index + 1;
      return true;
    });
  }

  function preferredOption(options, label, control, kind) {
    const first = options[0];
    if (options.length < 2 || kind === "house") return first;
    const value = control.matchValue || control.value;
    if (kind === "settlement") {
      const wanted = addressName(value, kind).type;
      return (wanted && options.find(e => addressName(label(e), kind).type === wanted)) || first;
    }

    const code = control.streetType || streetCodes(value)[0];
    if (!code) return first;
    return options.find(e => streetCodes(label(e)).includes(code)) || first;
  }

  function matches(label, value, kind, code, single = false) {
    const actual = addressName(label, kind),
      wanted = addressName(value, kind);
    return (
      actual.name === wanted.name &&
      (kind === "street" && code
        ? actual.type.startsWith(code) || (single && !actual.type)
        : !wanted.type || actual.type === wanted.type)
    );
  }
  const adminName = (value) =>
    norm(value).replace(
      /^(?:область|обл\.?|район|р-н)\s+|\s+(?:область|обл\.?|район|р-н)$/g,
      "",
    );

  // Selectors and platform-specific label structure come only from the server recipe.
  function fill(form, control, input, dom) {
    const config = control.autocomplete || {},
      { query, visible, enabled } = dom;
    const scope = config.scopeSelector
      ? input.closest(config.scopeSelector)
      : document;
    if (!scope) return;
    const options = () =>
      query(config.optionSelector || '[role="option"]', scope).filter(
        (e) => visible(e) && enabled(e) && !/^\s*Добавить\s*:/iu.test(e.textContent),
      );
    const rawLabel = (e) =>
      config.labelSelector
        ? query(config.labelSelector, e)[0]?.textContent || ""
        : e.textContent;
    const parts = (text) => {
      if (config.labelFormat === "settlement-with-admin-prefix") {
        return {label: String(text).replace(/^[^,]+(?:сельский\s+совет|сельсовет|с\/с),\s*/iu, ""), context: []};
      }
      if (config.labelFormat === "settlement-region-district") {
        const match = String(text).trim().match(/^(.+?)\s+(\S+\s+область)(?:\s+(.+?\s+район))?$/iu);
        if (match) return { label: match[1], context: match.slice(2).filter(Boolean) };
      }
      return { label: text, context: [] };
    };
    const label = (e) => parts(rawLabel(e)).label;
    const display = () => query(config.selectedValueSelector, scope)[0]?.textContent || "";
    let pending = form.pending.get(control.field);
    const retry = pending?.restart || (config.retryClearedQuery && pending?.phase === "query" && !input.value && !display() && (pending.retries || 0) < 2);
    if (!pending || retry) {
      if (config.selectedValueSelector && display()) {
        // Preserve a selection made before the helper started.
        const selected = parts(display());
        if (matches(selected.label, control.matchValue || control.value, config.kind, control.streetType, true) &&
            (control.matchContext || []).filter(Boolean).every(p => selected.context.map(adminName).includes(adminName(p))))
          form.done.add(control.field);
        else form.protected.add(control.field);
        return;
      }
      const current = input.value;
      const search = config.kind && config.kind !== "address"
        ? addressName(control.value, config.kind).name
        : String(control.value);
      if (
        !config.replaceInitialValue && current &&
        norm(current) !== norm(search) &&
        norm(current) !== norm(control.value)
      ) {
        form.protected.add(control.field);
        return;
      }
      // Autocomplete must stay focused: blur closes the list on several sites.
      input.focus();
      // Knockout does not search again when a restored query equals its observable.
      if (config.resetSameQuery && input.value === search) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "");
        input.dispatchEvent(new Event("input", {bubbles: true}));
      }
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, search);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (config.queryEvent === "keyup")
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      form.pending.set(control.field, { phase: "query", search, retries: retry ? (pending.retries || 0) + 1 : 0 });
      form.waiting = { field: control.field, tries: 0, until: Date.now() + 30000 };
      return;
    }
    if (pending.phase === "confirm") {
      // A click is not proof of acceptance. Wait for the selected label and closed popup.
      const value =
        config.confirm === "display-and-closed" ? display() :
        config.kind === "settlement" ? input.value.split(",")[0] : input.value;
      if (!options().length && (norm(value) === norm(pending.label) ||
          (["kufar.address_text", "kufar.address"].includes(control.field) && kufarSelectedAddress(value, pending.label))))
        form.done.add(control.field);
      return;
    }
    if (norm(input.value) !== norm(pending.search)) {
      form.protected.add(control.field);
      return;
    }
    if (
      config.busySelector &&
      query(config.busySelector, scope).some(visible)
    ) {
      pending.signature = null;
      return;
    }
    const available = options();
    // Full label equality ignores case and whitespace, but not punctuation or ё/е.
    const exactName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
    // Prefer the literal city over a namesake with an administrative prefix.
    const literal = available.filter(e => exactName(rawLabel(e)) === exactName(control.value));
    const candidates = config.selection === "single-or-exact"
      ? available.length === 1 ? available : literal.length ? literal : available.filter(e => exactName(label(e)) === exactName(control.value))
      : config.selection === "type-then-first"
        ? [preferredOption(available, label, control, config.kind)].filter(Boolean)
        : available.filter((e) => {
      if (!matches(label(e), control.matchValue || control.value, config.kind, control.streetType, available.length === 1)) return false;
      const context = config.contextSelector
        ? query(config.contextSelector, e)
            .flatMap((n) => n.textContent.split(","))
            .map(adminName)
        : parts(rawLabel(e)).context.map(adminName);
      return (control.matchContext || [])
        .filter(Boolean)
        .every((part) => context.includes(adminName(part)));
    });
    if (candidates.length !== 1) {
      pending.signature = null;
      return;
    }
    const option = candidates[0];
    if (config.confirm) {
      const signature = config.selection === "single-or-exact" || config.selection === "type-then-first"
        ? JSON.stringify(available.map(e => exactName(e.textContent))) : norm(option.textContent);
      // Debounced searches briefly display results from the previous query.
      if (pending.signature !== signature) {
        pending.signature = signature;
        return;
      }
      pending.phase = "confirm";
      pending.label = rawLabel(option);
      form.waiting = { field: control.field, tries: 0, until: Date.now() + 30000 };
    }
    if (config.optionEvent === "mousedown")
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    else option.click();
    if (!config.confirm) form.done.add(control.field);
  }
  // Responsive address pickers stage a choice in a sheet. Apply only our own
  // selected suggestion, then confirm the value on the original form trigger.
  function fillSheet(form, control, dom) {
    const config = control.autocomplete, sheet = config.sheet;
    const {query, visible, enabled} = dom;
    if (!control.value) return;
    const trigger = query(sheet.triggerSelector).filter(visible)[sheet.triggerIndex || 0];
    if (!trigger || !enabled(trigger)) return;
    const scopes = query(sheet.scopeSelector).filter(visible);
    const scope = scopes.find(e => query(sheet.headingSelector, e).some(h => norm(h.textContent) === norm(sheet.heading)));
    let pending = form.pending.get(control.field);
    if (!scope) {
      if (pending?.sheetApplied) {
        if (norm(trigger.textContent) === norm(pending.label)) form.done.add(control.field);
        return;
      }
      if (scopes.length || pending?.phase === "sheet-opening") return;
      if (pending) { form.protected.add(control.field); return; }
      const current = norm(trigger.textContent);
      if (current !== norm(sheet.emptyLabel)) {
        if (matches(current, control.matchValue || control.value, config.kind, control.streetType, true))
          form.done.add(control.field);
        else form.protected.add(control.field);
        return;
      }
      form.pending.set(control.field, {phase:"sheet-opening"});
      form.waiting = {field:control.field, tries:0, until:Date.now() + 30000};
      form.clickControl(trigger);
      form.progress++;
      return;
    }
    const input = query(sheet.inputSelector, scope).find(e => visible(e) && enabled(e));
    if (!input) return;
    if (pending?.phase === "sheet-opening") {
      form.pending.delete(control.field);
      pending = undefined;
    }
    if (pending?.phase === "confirm") {
      if (pending.sheetApplied) return;
      const selected = query(config.optionSelector, scope).find(e => {
        const label = config.labelSelector ? query(config.labelSelector, e)[0]?.textContent : e.textContent;
        return norm(label) === norm(pending.label) && query(sheet.selectedMarker, e).length;
      });
      const apply = query(sheet.applySelector, scope).filter(e => visible(e) && enabled(e) && norm(e.textContent) === norm(sheet.applyText));
      if (selected && apply.length === 1) {
        pending.sheetApplied = true;
        form.clickControl(apply[0]);
        form.progress++;
      }
      return;
    }
    // Do not take over a sheet opened independently by the user.
    if (!pending && form.waiting?.field !== control.field) return;
    fill(form, {...control, autocomplete:{...config, scopeSelector:sheet.scopeSelector}}, input, dom);
  }
  root.AutopostRentalAutocomplete = { fill, fillSheet, addressName };
})(globalThis);
