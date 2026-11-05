(function (root) {
  "use strict";
  const norm = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("ru");
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
      ["проспект", ["проспект", "пр-т", "просп"]],
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
  function matches(label, value, kind) {
    const actual = addressName(label, kind),
      wanted = addressName(value, kind);
    return (
      actual.name === wanted.name &&
      (!wanted.type || actual.type === wanted.type)
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
        (e) => visible(e) && enabled(e),
      );
    const label = (e) =>
      config.labelSelector
        ? query(config.labelSelector, e)[0]?.textContent || ""
        : e.textContent;
    let pending = form.pending.get(control.field);
    if (!pending) {
      const current = input.value;
      const search = config.kind
        ? addressName(control.value, config.kind).name
        : String(control.value);
      if (
        current &&
        norm(current) !== norm(search) &&
        norm(current) !== norm(control.value)
      ) {
        form.protected.add(control.field);
        return;
      }
      // Autocomplete must stay focused: blur closes the list on several sites.
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, search);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      form.pending.set(control.field, { phase: "query", search });
      form.waiting = { field: control.field, tries: 0 };
      return;
    }
    if (pending.phase === "confirm") {
      // A click is not proof of acceptance. Wait for the selected label and closed popup.
      const value =
        config.kind === "settlement" ? input.value.split(",")[0] : input.value;
      if (!options().length && norm(value) === norm(pending.label))
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
    const candidates = options().filter((e) => {
      if (!matches(label(e), control.matchValue || control.value, config.kind)) return false;
      const context = config.contextSelector
        ? query(config.contextSelector, e)
            .flatMap((n) => n.textContent.split(","))
            .map(adminName)
        : [];
      return (control.matchContext || [])
        .filter(Boolean)
        .every((part) => context.includes(adminName(part)));
    });
    if (candidates.length !== 1) {
      pending.signature = null;
      return;
    }
    const option = candidates[0];
    if (config.confirm === "value-and-closed") {
      const signature = norm(option.textContent);
      // Debounced searches briefly display results from the previous query.
      if (pending.signature !== signature) {
        pending.signature = signature;
        return;
      }
      pending.phase = "confirm";
      pending.label = label(option);
      form.waiting = { field: control.field, tries: 0 };
    }
    option.click();
    if (!config.confirm) form.done.add(control.field);
  }
  root.AutopostRentalAutocomplete = { fill, addressName };
})(globalThis);
