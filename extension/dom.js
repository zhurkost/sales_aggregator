/* DOM adapter. No credentials/cookies, private API calls, captcha solving or final submit. */
(function (root) {
  "use strict";
  const normalize = (v) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[\s_*:(),.\-\/]+/g, " ")
      .trim();
  const aliases = {
    category: ["категория", "конечный подраздел", "подраздел"],
    title: ["subject", "title", "название объявления", "заголовок"],
    description: [
      "description",
      "описание",
      "текст объявления",
      "message",
      "comment",
    ],
    brand: ["brand", "make", "марка", "марка автомобиля"],
    model: ["model", "модель", "модель автомобиля"],
    year: ["year", "год", "год выпуска"],
    mileage: ["mileage", "пробег", "пробег км"],
    engine: ["engine", "объем", "объем л", "объем двигателя"],
    fuel: ["fuel", "тип двигателя", "топливо"],
    transmission: ["transmission", "gearbox", "коробка передач", "кпп"],
    drive: ["drive", "привод"],
    body: ["body_type", "тип кузова", "кузов"],
    color: ["color", "цвет"],
    partName: [
      "partName",
      "название детали",
      "наименование запчасти",
      "запчасть",
    ],
    partNumber: [
      "partNumber",
      "oem",
      "артикул",
      "номер запчасти",
      "оригинальный номер",
    ],
    manufacturer: ["manufacturer", "производитель"],
    condition: ["condition", "состояние"],
    price: ["price", "цена", "стоимость"],
    currency: ["currency", "валюта"],
    city: ["city", "город", "населенный пункт"],
    phone: ["phone", "телефон", "номер телефона"],
    vin: ["vin", "vehicle_vin", "vin номер"],
    quantity: ["quantity", "количество"],
    availability: ["availability", "наличие"],
  };
  const kufar = {
    brand: "cars_brand_v2",
    model: "cars_model_v2",
    year: "regdate",
    mileage: "mileage",
    engine: "cars_capacity",
    fuel: "cars_engine",
    transmission: "cars_gearbox",
    body: "cars_type",
    drive: "cars_drive",
    color: "cars_color",
    partName: "spares_passenger_group",
    partNumber: "spares_parts_number",
    condition: "condition",
    city: "area",
    currency: "price",
  };
  const variants = {
    fuel: [
      ["Бензин", "petrol"],
      ["Дизель", "diesel"],
      ["Электро", "Электричество"],
    ],
    transmission: [
      ["Автомат", "Автоматическая", "АКПП"],
      ["Механика", "Механическая", "МКПП"],
    ],
    currency: [
      ["BYN", "руб.", "р.", "Белорусские рубли"],
      ["USD", "$", "Доллары"],
      ["EUR", "€", "Евро"],
    ],
    condition: [
      ["Новая", "Новый", "Новое"],
      ["Б/у", "С пробегом", "Бывший в употреблении"],
    ],
  };
  const values = (key, value) => {
    let result = [value];
    for (const group of variants[key] || [])
      if (group.some((v) => normalize(v) === normalize(value))) result = group;
    if (key === "engine" && /^\d([.,]\d)?$/.test(value))
      result.push(
        Number(value.replace(",", ".")).toFixed(1),
        String(Number(value.replace(",", "."))),
      );
    return result.map(normalize);
  };
  function visible(e) {
    return (
      !!e &&
      e.isConnected &&
      !e.hidden &&
      getComputedStyle(e).display !== "none" &&
      getComputedStyle(e).visibility !== "hidden" &&
      e.getBoundingClientRect().width > 0
    );
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const dropdownSelector = '[data-testid="base-dropdown-ui"],[role="combobox"],.select2-selection,[class*="multiselect__tags"],[class*="vs__dropdown-toggle"]';
  function unavailable(el) {
    return !el || el.disabled || el.readOnly || Boolean(el.closest('[aria-disabled="true"],[aria-readonly="true"],[inert]'));
  }
  function fieldState(target) {
    if (!target) return '';
    // React can keep the same wrapper while replacing its options, enabling
    // it, or changing the selected parent. Element identity is not readiness.
    return JSON.stringify([
      visible(target), target.textContent,
      [...target.querySelectorAll('input,select,textarea,' + dropdownSelector)].map(el =>
        [el.value, unavailable(el), el.getAttribute('aria-busy')]),
    ]);
  }
  function metadata(e) {
    const result = [
      "name",
      "id",
      "aria-label",
      "placeholder",
      "data-testid",
    ].map((k) => e.getAttribute(k) || "");
    for (const label of e.labels || []) result.push(label.textContent);
    for (const id of (e.getAttribute("aria-labelledby") || "").split(/\s/))
      if (id) result.push(document.getElementById(id)?.textContent || "");
    return result.map(normalize);
  }
  function findNative(key, platform) {
    if(platform==='onliner'&&key==='price') {
      const control=document.querySelector('#topic_price:not([type="hidden"])');
      return visible(control)&&!control.disabled?control:null;
    }
    if(platform==='bamper') {
      const names={brand:'MARKA_ID[]',model:'MODEL_ID[]',year:'YEAR',engine:'ENGINE_VALUE',fuel:'FUEL_ID',body:'KUZOV_ID',transmission:'PRIVOD_ID',partName:'TAG_ID',partNumber:'ORIGINAL_NUM',description:'COMMENT',price:'PRICE',phone:'PHONE',vin:'VIN'};
      if(names[key])return bamperControl(names[key]);
    }
    if (platform === "kufar") {
      const names = {
        title: "subject",
        description: "body",
        price: "price",
        vin: "vehicle_vin",
        mileage: "mileage",
        partNumber: "spares_parts_number",
      };
      if (names[key])
        return (
          [...document.querySelectorAll(`[name="${names[key]}"]`)].find(
            (e) =>
              ["INPUT", "TEXTAREA"].includes(e.tagName) &&
              visible(e) &&
              !e.disabled &&
              !e.readOnly,
          ) || null
        );
    }
    const candidates = [];
    for (const el of document.querySelectorAll(
      "input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]),textarea,select",
    )) {
      if (
        !visible(el) ||
        el.disabled ||
        el.readOnly ||
        el.closest('header,nav,[role="search"]')
      )
        continue;
      const labels = metadata(el);
      let score = 0;
      for (const alias of aliases[key] || [])
        if (labels.includes(normalize(alias))) score = Math.max(score, 100);
      if (!score) {
        const label = el.closest("label") || el.parentElement?.parentElement;
        const t = normalize(label?.textContent).slice(0, 120);
        if ((aliases[key] || []).some((a) => t === normalize(a))) score = 60;
      }
      if (score) candidates.push({ el, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] && candidates[0].score !== candidates[1]?.score
      ? candidates[0].el
      : null;
  }
  function bamperControl(name) {
    const candidates=[...document.querySelectorAll('input,select,textarea')].filter(e=>e.name===name&&!e.disabled&&!e.readOnly&&e.type!=='hidden'&&visible(e.closest('tr')));
    return candidates.length===1?candidates[0]:null;
  }
  function bamperRadio(task,key,value) {
    const name={currency:'CURRENCY',condition:'IS_NEW',availability:'PREORDER'}[key];
    const desired=key==='currency'?value:key==='condition'?({'Новая':'1','Б/у':'0'})[value]:({'В наличии':'0','Под заказ':'1'})[value];
    if(!desired)return 'Нет точного варианта';
    const controls=[...document.querySelectorAll('input[type="radio"]')].filter(e=>e.name===name&&visible(e)&&!e.disabled);
    const target=controls.find(e=>e.value===desired),current=controls.find(e=>e.checked);
    if(!target)return 'Поле пока не появилось';
    task.radioChoices ||= new Map();
    const previous=task.radioChoices.get(key);
    if(previous&&previous!==current)return 'Уже изменено пользователем';
    if(current!==target)target.click();
    if(!target.checked)return 'Значение не принято';
    task.radioChoices.set(key,target);return null;
  }
  function setNative(el, key, value) {
    if (!el) return "Поле пока не появилось";
    if (unavailable(el)) return "Поле пока недоступно";
    let next = String(value);
    if (el.tagName === "SELECT") {
      const options = [...el.options].filter(
        (o) =>
          !o.disabled && values(key, value).includes(normalize(o.textContent)),
      );
      if (options.length !== 1) return "Нет точного варианта";
      next = options[0].value;
      const selected = el.options[el.selectedIndex];
      if (
        el.value &&
        !/^(выберите|любой|не выбран|select|—|--)/i.test(
          selected?.textContent.trim() || "",
        )
      )
        return el.value === next ? null : "Уже заполнено пользователем";
    } else if (String(el.value || "").trim())
      return String(el.value) === next ? null : "Уже заполнено пользователем";
    if (el.maxLength > 0 && next.length > el.maxLength) {
      if (key === "title") next = next.slice(0, el.maxLength);
      else return "Текст длиннее лимита площадки";
    }
    if (el.type === "number") {
      next = next.replace(/\s/g, "").replace(",", ".");
      if (
        !/^\d+(\.\d+)?$/.test(next) ||
        (el.min && +next < +el.min) ||
        (el.max && +next > +el.max)
      )
        return "Число вне допустимого диапазона";
    }
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    return el.value === next ? null : "Значение не принято";
  }
  function exact(
    text,
    scope = document,
    selector = 'button,[role="button"],[role="option"],li,span,div,a',
  ) {
    const wanted = normalize(text);
    const nodes = [...scope.querySelectorAll(selector)].filter(
      (e) => visible(e) && normalize(e.textContent) === wanted,
    );
    return nodes.filter((e) => !nodes.some((n) => n !== e && e.contains(n)));
  }
  function scopeFor(key, listing, platform) {
    if (platform === "kufar") {
      let name = kufar[key];
      if (
        listing.category === "parts" &&
        ["year", "engine", "fuel", "transmission", "body"].includes(key)
      )
        name = {
          year: "spares_regdate",
          engine: "spares_capacity",
          fuel: "spares_cars_engine",
          transmission: "spares_gearbox",
          body: "spares_cars_type",
        }[key];
      return name ? document.querySelector(`[data-name="${name}"]`) : null;
    }
    const labels = [
      ...document.querySelectorAll('label,legend,[class*="label" i]'),
    ].filter(
      (e) =>
        visible(e) &&
        (aliases[key] || []).map(normalize).includes(normalize(e.textContent)),
    );
    if (labels.length !== 1) return null;
    return labels[0].closest("fieldset") || labels[0].parentElement;
  }
  async function custom(key, value, listing, platform, explicitScope) {
    const scope = explicitScope || scopeFor(key, listing, platform);
    if (!scope || !visible(scope)) return "Поле пока не появилось";
    if (unavailable(scope)) return "Поле пока недоступно";
    const dropdown = scope.querySelector(dropdownSelector);
    const native = scope.querySelector(
      "input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select",
    );
    if (
      native &&
      visible(native) &&
      !(platform === "kufar" && (key === "currency" || dropdown?.matches('[data-testid="base-dropdown-ui"]')))
    ) {
      const autocomplete =
        native.getAttribute("role") === "combobox" ||
        native.getAttribute("aria-autocomplete") === "list" ||
        native.closest(
          '.select2-search,.multiselect,.p-autocomplete,[class*="vs__"]',
        );
      if (!autocomplete) return setNative(native, key, value);
      const reason = setNative(native, key, value);
      if (reason) return reason;
      for (let i = 0; i < 12; i++) {
        await pause(150);
        const matches = [
          ...document.querySelectorAll(
            '[role="option"],.multiselect__option,.vs__dropdown-option,.p-autocomplete-option',
          ),
        ].filter(
          (e) =>
            visible(e) && values(key, value).includes(normalize(e.textContent)),
        );
        if (matches.length === 1) {
          matches[0].click();
          return null;
        }
      }
      return "Введите точное название и выберите вариант списка";
    }
    const desired = values(key, value);
    const buttons = [
      ...scope.querySelectorAll('button,[role="button"],[role="radio"]'),
    ].filter(visible);
    const match = buttons.filter((e) =>
      desired.includes(normalize(e.textContent)),
    );
    if (match.length === 1) {
      const selected = buttons.find(
        (e) =>
          e.getAttribute("aria-checked") === "true" ||
          e.getAttribute("aria-pressed") === "true" ||
          /chip__filled|chip--filled|selected/.test(e.className),
      );
      if (selected && selected !== match[0]) return "Уже выбрано пользователем";
      if (!selected) match[0].click();
      return null;
    }
    if (!dropdown || !visible(dropdown)) return "Не распознан список";
    if (unavailable(dropdown)) return "Поле пока недоступно";
    const current = normalize(dropdown.textContent);
    if (desired.includes(current)) return null;
    if (
      key !== "currency" &&
      current &&
      !/выберите|введите|любой|вся беларусь|не выбран|select/i.test(current)
    )
      return "Уже выбрано пользователем";
    const popup = scope.querySelector('[data-testid="dropdown-popup-ui"]');
    const opened = !popup || !visible(popup);
    if (opened) dropdown.click();
    for (let i = 0; i < 20; i++) {
      await pause(150);
      if (!scope.isConnected || unavailable(dropdown)) return "Поле обновляется, ждём загрузки вариантов";
      if (platform === 'kufar' && key === 'model' && listing.brand &&
          !values('brand',listing.brand).includes(normalize(scopeFor('brand',listing,platform)?.querySelector(dropdownSelector)?.textContent)))
        return "Марка изменилась, проверьте модель автомобиля";
      const options = [
        ...(platform === 'kufar' && scope.querySelector('[data-testid="dropdown-popup-ui"]') ? scope : document).querySelectorAll(
          '[role="option"],[class*="DefaultItem"][class*="item"],.select2-results__option,.multiselect__option,.vs__dropdown-option',
        ),
      ].filter(visible);
      const matches = options.filter((e) =>
        desired.includes(normalize(e.textContent)),
      );
      if (matches.length === 1) {
        matches[0].click();
        // A click or text in the dropdown search is not a selected model.
        // Check the rendered value, including when React replaced the wrapper.
        for (let confirm = 0; confirm < 15; confirm++) {
          await pause(100);
          const field = scope.isConnected ? scope : explicitScope
            ? [...document.querySelectorAll('[data-name]')].find(el => el.dataset.name === scope.dataset.name)
            : scopeFor(key, listing, platform);
          if (desired.includes(normalize(field?.querySelector(dropdownSelector)?.textContent))) return null;
        }
        return "Значение ещё не подтверждено площадкой";
      }
    }
    // Close only the popup we opened, never select an approximate model or part.
    const close = [
      ...document.querySelectorAll('[data-name="kufar_modal_close_icon"]'),
    ].filter(visible);
    if (opened) {
      if (close.length === 1) close[0].click();
      else if (dropdown.isConnected && (!popup || visible(popup))) dropdown.click();
    }
    return "Нужен точный выбор из списка";
  }
  async function category(task, platform) {
    const mapping = task.mapping;
    if (platform === "kufar") {
      const scope = document.querySelector('[data-name="category"]');
      const path =
        mapping?.path ||
        (task.listing.category === "cars"
          ? ["Авто и запчасти", "Легковые авто"]
          : task.listing.category === "parts"
            ? ["Авто и запчасти", "Запчасти"]
            : []);
      if (!path.length) return false;
      if (!scope) return false;
      if (!normalize(scope.textContent).includes(normalize(path.at(-1)))) {
        const chooser = document.querySelector(
          '[data-testid="ain-show-all-categories"]',
        );
        if (!chooser) return false;
        chooser.click();
        for (const label of path) {
          let picked = false;
          for (let i = 0; i < 12; i++) {
            await pause(150);
            const options = exact(label).filter((e) => !scope.contains(e));
            if (options.length === 1) {
              options[0].click();
              picked = true;
              break;
            }
          }
          if (!picked) return false;
        }
        await pause(300);
      }
      if (task.listing.category === "parts" && !mapping?.attributes?.some(a=>a.key==="spares_type")) {
        const type = document.querySelector('[data-name="spares_type"]');
        const selected = type?.querySelector(
          '[aria-checked="true"],[aria-pressed="true"],[class*="chip__filled"]',
        );
        if (!selected) {
          const options = type ? exact("Запчасти для легковых авто", type) : [];
          if (options.length === 1) {
            options[0].click();
            await pause(300);
          }
        }
      }
      const categorySelected=normalize(document.querySelector('[data-name="category"]')?.textContent).includes(normalize(path.at(-1)));
      if(!categorySelected)return false;
      for(const attribute of mapping?.attributes||[]){
        if(!/^[a-z][a-z0-9_]*$/.test(attribute.key))return false;
        const scope=document.querySelector(`[data-name="${attribute.key}"]`);
        if(!scope||await custom(attribute.key,attribute.label,task.listing,platform,scope))return false;
      }
      return true;
    }
    if (
      platform === "onliner" &&
      task.listing.category !== "cars" &&
      mapping?.id
    ) {
      const category = document.querySelector(
        'select[name="f"],select[name="forum_id"]',
      );
      if (category) {
        const option = [...category.options].find(
          (o) => o.value === mapping.id,
        );
        if (option) return !setNative(category, "category", option.textContent);
      }
    }
    if(platform==='flagma'&&mapping){
      const control=findNative('category',platform);
      if(control)return !setNative(control,'category',mapping.path.at(-1));
      return !await custom('category',mapping.path.at(-1),task.listing,platform);
    }
    if(platform==='onliner'&&task.listing.category!=='cars')return false;
    return true;
  }
  async function fillFields(task, platform) {
    const result = { filled: [], skipped: [], details: [] };
    const keys = [
      "title",
      "brand",
      "model",
      "year",
      "body",
      "engine",
      "fuel",
      "transmission",
      "drive",
      "color",
      "mileage",
      "vin",
      "partName",
      "partNumber",
      "manufacturer",
      "condition",
      "quantity",
      "availability",
      "description",
      "currency",
      "price",
      "city",
      "phone",
    ];
    for (const key of keys) {
      const value = task.listing[key];
      if (!value) continue;
      if (platform === 'kufar' && key === 'model' && task.listing.brand) {
        const brand = scopeFor('brand',task.listing,platform)?.querySelector(dropdownSelector);
        if (!values('brand',task.listing.brand).includes(normalize(brand?.textContent))) {
          result.skipped.push(key);
          result.details.push('Модель: ждём выбора марки ' + task.listing.brand);
          continue;
        }
      }
      if(platform==='bamper'&&['currency','condition','availability'].includes(key)) {
        const reason=bamperRadio(task,key,value);
        if(reason){result.skipped.push(key);result.details.push(key+': '+reason);}else result.filled.push(key);
        continue;
      }
      const control = findNative(key, platform);
      let reason;
      if (key === "price") {
        const currencyScope = scopeFor("currency", task.listing, platform);
        const label =
          platform==='onliner'&&control?.id==='topic_price'&&/ƃ/.test(control.parentElement.textContent) ? 'BYN' :
          platform==='bamper' ? document.querySelector('input[name="CURRENCY"]:checked')?.value :
          platform === "kufar"
            ? currencyScope?.querySelector('[data-testid="base-dropdown-ui"]')
                ?.textContent
            : findNative("currency", platform)?.selectedOptions?.[0]
                ?.textContent || findNative("currency", platform)?.value;
        if (
          !values("currency", task.listing.currency).includes(normalize(label))
        ) {
          result.skipped.push(key);
          result.details.push("Цена: валюта формы не подтверждена");
          continue;
        }
      }
      task.attempts ||= new Map();
      const target = control || scopeFor(key, task.listing, platform);
      const previous = task.attempts.get(key);
      const state = fieldState(target);
      if (
        !control &&
        previous?.target === target &&
        previous?.value === value &&
        previous?.state === state &&
        Date.now() < previous.retryAt
      ) {
        result.skipped.push(key);
        result.details.push(
          (aliases[key]?.at(-1) || key) + ": " + previous.reason,
        );
        continue;
      }
      reason = control
        ? setNative(control, key, value)
        : await custom(key, value, task.listing, platform);
      if (reason && !control) {
        const count = previous?.target === target && previous?.value === value && previous?.state === state ? previous.count + 1 : 1;
        task.attempts.set(key, { target, value, reason, state:fieldState(target), count, retryAt:Date.now()+Math.min(30000,2000*2**Math.min(count-1,4)) });
      }
      else task.attempts.delete(key);
      if (reason) {
        result.skipped.push(key);
        result.details.push((aliases[key]?.at(-1) || key) + ": " + reason);
      } else result.filled.push(key);
    }
    // Fill parent fields first; optional attributes may only mount afterwards.
    for(const attribute of task.attributes || []) {
      if(!/^[a-z][a-z0-9_]{0,79}$/.test(attribute.key)) continue;
      const key = 'attribute:'+attribute.key;
      let reason;
      if(platform==='kufar'&&(!attribute.platform||attribute.platform==='kufar')) {
        const scope = document.querySelector(`[data-name="${attribute.key}"]`);
        reason = scope ? await custom(attribute.key,attribute.text,task.listing,platform,scope) : 'Поле пока не появилось';
      } else if(platform==='onliner'&&attribute.key==='onliner_short_description')reason=setNative(document.querySelector('textarea[name="topic_desc"]'),key,attribute.text);
      else if(platform==='bamper') {
        const names={bamper_modification:'VERSIA',bamper_engine_code:'ENGINE_MODEL_ID',bamper_vin:'VIN',bamper_stock_code:'EXT_ID',bamper_discount:'DISCOUNT',spares_capacity:'ENGINE_VALUE',spares_cars_engine:'FUEL_ID',spares_gearbox:'PRIVOD_ID',spares_cars_type:'KUZOV_ID',spares_regdate:'YEAR',spares_parts_code:'EXT_ID',content_video:'VIDEO[]'};
        if(!names[attribute.key])continue;
        reason=setNative(bamperControl(names[attribute.key]),attribute.key==='spares_gearbox'?'transmission':key,attribute.text);
      } else continue;
      if(reason) {result.skipped.push(key);result.details.push(attribute.label+': '+reason);}
      else result.filled.push(key);
    }
    return result;
  }
  root.AutopostDOM = {
    normalize,
    visible,
    findNative,
    setNative,
    scopeFor,
    values,
    exact,
    category,
    fillFields,
    pause,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = root.AutopostDOM;
})(globalThis);
