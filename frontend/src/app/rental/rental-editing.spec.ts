import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalEditorComponent } from "./rental-editor.component";
import { RentalDraftStore } from "./rental-draft.store";
import { rentalApi } from "./rental-api";
import type { EditorSchema, Prepared } from "./rental-models";

const schema: EditorSchema = {
  cardVersion: "test",
  addressSuggestions: false,
  photoLimit: 12,
  canonicalValues: {},
  card: {
    version: 2,
    addressDependentFacts: [],
    profileDefaults: [
      { setting: "phone", field: "contact.phone" },
      { setting: "contactPerson", field: "contact.name" },
      { setting: "company", field: "contact.organization_name" },
    ],
  },
  category: {
    options: [
      {
        id: "group.contact",
        name: "Контакты",
        type: "group",
        description: "",
        fill_rule: {},
        options: [
          "contact.phone",
          "contact.name",
          "contact.organization_name",
        ].map((id) => ({
          id,
          name: id,
          type: "text",
          description: "",
          fill_rule: {},
          options: [],
        })),
      },
    ],
  },
  platforms: {
    kufar: {
      name: "Kufar",
      labels: {},
      choiceLabels: {},
      constants: {},
      bindings: [],
    },
  },
};
const report: Prepared[] = [
  {
    platform: "kufar",
    values: {},
    checksPassed: false,
    form: [],
    manual: [],
    publicationReady: false,
    issues: [
      {
        field: "description",
        source: "listing.description",
        code: "required",
        message: "Добавьте описание",
      },
    ],
  },
];
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function mockApi() {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    response(
      url.endsWith("/editor")
        ? schema
        : url.endsWith("/drafts")
          ? { drafts: [] }
          : url.endsWith("/prepare")
            ? { platforms: report }
            : { revision: 1 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("rental editing and validation", () => {
  it("shows what each platform receives and never calls a card with manual fields prepared", async () => {
    mockApi();
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance;
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(c.store.schema).not.toBeNull();
      });
      c.store.schema!.platforms["onliner"] = { name: "Onliner", labels: {}, choiceLabels: {}, constants: {}, bindings: [] };
      const reason = "Ссылка на YouTube на Kufar доступна партнёрам площадки; перенос ссылки не настроен.";
      c.store.results = [
        {
          platform: "kufar",
          values: {},
          // The server turns automatic submission off while values are entered by hand.
          checksPassed: false,
          publicationReady: false,
          issues: [{ field: "", source: "", code: "manual_fields", message: "Часть заполненных полей нужно ввести на площадке вручную — автоматическая подача выключена." }],
          form: [
            { field: "kufar.title", name: "Название объявления", value: "Квартира у парка" },
            { field: "kufar.price", name: "Цена", value: 900 },
          ],
          manual: [{ field: "kufar.video", name: "Видео на YouTube", value: ["https://youtu.be/x"], reason }],
        },
        {
          platform: "onliner",
          values: {},
          checksPassed: true,
          publicationReady: false,
          issues: [],
          form: [{ field: "onliner.description", name: "Описание", value: "Текст" }],
          manual: [],
        },
      ];
      c.store.check.checked = true;
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(el.querySelectorAll(".result-platforms button")).map((b) => b.textContent!.replace(/\s+/g, " ").trim());
      expect(buttons).toEqual([
        "Kufar · Часть вручную Уйдёт в форму: 2 поля · Вручную на площадке: 1",
        "Onliner · Подготовлено Уйдёт в форму: 1 поле · Вручную на площадке: 0",
      ]);
      expect(el.querySelector(".issues")!.textContent).toContain("автоматическая подача выключена");
      // Any other remark still asks to check the card.
      c.store.results[0].issues.push({ field: "kufar.price", source: "rental.monthly_price", code: "required", message: "Цена" });
      fixture.detectChanges();
      expect(el.querySelector(".result-platforms button strong")!.textContent!.trim()).toBe("Kufar · Нужна проверка");
      c.store.results[0].issues.pop();
      c.openPanel("result");
      fixture.detectChanges();
      const kufar = el.querySelector(".prepared-platform")!;
      expect(Array.from(kufar.querySelectorAll("h4")).map((h) => h.textContent)).toEqual([
        "Уйдёт в форму",
        "Вручную на площадке",
      ]);
      expect(
        Array.from(kufar.querySelectorAll("dl")).map((dl) =>
          Array.from(dl.children).map((e) => e.textContent!.trim()),
        ),
      ).toEqual([
        ["Название объявления", "Квартира у парка", "Цена", "900"],
        ["Видео на YouTube", "https://youtu.be/x " + reason],
      ]);
    } finally {
      fixture.destroy();
    }
  });
  it("keeps the visible report and textarea focus, debouncing saves and rechecks", async () => {
    const fetch = mockApi();
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance;
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(c.store.schema).not.toBeNull();
      });
      await c.store.prepare();
      fixture.detectChanges();
      fetch.mockClear();
      vi.useFakeTimers();
      const el = fixture.nativeElement as HTMLElement;
      const panel = el.querySelector(".results");
      const input = el.querySelector<HTMLTextAreaElement>(
        "textarea.source-description",
      )!;
      input.focus();
      for (const text of ["С", "Сд", "Сдам квартиру"]) {
        input.value = text;
        input.dispatchEvent(new Event("input"));
        fixture.detectChanges();
        await vi.advanceTimersByTimeAsync(400);
        expect(fetch).not.toHaveBeenCalled();
        expect(el.querySelector(".results")).toBe(panel);
        expect(document.activeElement).toBe(input);
        expect(c.store.check.stale).toBe(true);
        expect(el.textContent).toContain("Ожидает проверки");
      }
      await vi.advanceTimersByTimeAsync(800);
      fixture.detectChanges();
      expect(
        fetch.mock.calls.filter(([url]) => url.endsWith("/prepare")),
      ).toHaveLength(1);
      const writes = fetch.mock.calls.filter(
        ([, init]) =>
          init?.method === "POST" && JSON.parse(String(init.body)).draft,
      );
      expect(writes).toHaveLength(1);
      expect(
        JSON.parse(String(writes[0][1]?.body)).draft.values[
          "listing.description"
        ],
      ).toBe("Сдам квартиру");
      expect(el.querySelector(".results")).toBe(panel);
      expect(document.activeElement).toBe(input);
      expect(c.store.check.stale).toBe(false);
      expect(c.store.status).toBe("Сохранено");
      expect(input.disabled).toBe(false);
    } finally {
      fixture.destroy();
    }
  });

  it("updates «Мои квартиры» locally after autosaves and re-reads it only when the panel opens", async () => {
    let revision = 0;
    const other = { id: "other", title: "Другая", address: "", revision: 3 };
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      response(
        url.endsWith("/editor")
          ? schema
          : url.endsWith("/drafts")
            ? { drafts: [other] }
            : { revision: ++revision },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance,
      el = fixture.nativeElement as HTMLElement;
    try {
      await vi.waitFor(() => expect(c.store.drafts).toEqual([other]));
      fetch.mockClear();
      vi.useFakeTimers();
      for (const title of ["Квартира", "Квартира у метро", "Квартира у метро Немига"]) {
        c.store.draft.values["listing.title"] = title;
        c.store.changed();
        await vi.advanceTimersByTimeAsync(1300);
      }
      c.addressChanged({
        provider: "manual",
        label: "Минск, Брикета 18",
        countryIso: "BY",
        settlement: "",
        street: "",
        house: "",
        confirmed: false,
      });
      await vi.advanceTimersByTimeAsync(1300);
      expect(
        fetch.mock.calls.map(([url, init]) => `${init?.method} ${url}`),
      ).toEqual(Array(4).fill(`POST /api/workspace/rental/drafts/${c.store.id}`));
      expect(c.store.drafts).toEqual([
        {
          id: c.store.id,
          revision: 4,
          title: "Квартира у метро Немига",
          address: "Минск, Брикета 18",
        },
        other,
      ]);
      fixture.detectChanges();
      expect(el.textContent).toContain("Мои квартиры · 2");
      c.openPanel("saved");
      await vi.advanceTimersByTimeAsync(0);
      expect(
        fetch.mock.calls.filter(
          ([url, init]) => init?.method === "GET" && url.endsWith("/drafts"),
        ),
      ).toHaveLength(1);
    } finally {
      fixture.destroy();
    }
  });

  it("ignores a late validation response after editing and after changing apartments", async () => {
    vi.useFakeTimers();
    const store = new RentalDraftStore(
      () => "owner",
      () => {},
    );
    store.results = structuredClone(report);
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const request = store.check.refresh();
    store.draft.values["listing.description"] = "Новое описание";
    store.changed();
    finish(response({ platforms: [] }));
    await request;
    expect(store.results).toEqual(report);
    expect(store.check.stale).toBe(true);
    const next = store.check.refresh();
    store.id = "another";
    store.check.clear();
    finish(response({ platforms: report }));
    await next;
    expect(store.results).toEqual([]);
    expect(store.check.checked).toBe(false);
    store.destroy();
  });

  it("retains the report on validation failure and retries without blocking input", async () => {
    mockApi();
    const c = new RentalEditorComponent();
    await c.store.prepare();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ error: "Временно недоступно" }, 503)),
    );
    await c.store.check.refresh();
    expect(c.store.results).toEqual(report);
    expect(c.store.check.stale).toBe(true);
    expect(c.store.check.error).toBe("Временно недоступно");
    expect(c.store.busy).toBe(false);
    mockApi();
    await c.store.prepare();
    expect(c.store.check.stale).toBe(false);
    expect(c.store.check.error).toBe("");
    c.ngOnDestroy();
  });

  it("keeps validation separate from a failed save", async () => {
    vi.useFakeTimers();
    const c = new RentalEditorComponent();
    c.store.changed();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/prepare")
          ? response({ platforms: report })
          : response({ error: "Не удалось сохранить" }, 503),
      ),
    );
    await c.store.prepare();
    expect(c.store.results).toEqual(report);
    expect(c.store.error).toBe("Не удалось сохранить");
    expect(c.store.dirty).toBe(true);
    expect(c.store.check.stale).toBe(false);
    c.ngOnDestroy();
  });
});

describe("rental contacts from the active profile", () => {
  it("fills new cards and saves the contact snapshot with the first edit", async () => {
    const fetch = mockApi();
    const profile = {
      phone: "+375 (29) 000-00-00",
      contactPerson: "Тестовое лицо",
      company: "Тестовая компания",
      city: "Минск",
    };
    const store = new RentalDraftStore(
      () => "owner",
      () => {},
      () => profile,
    );
    await store.load();
    expect(store.draft.values).toEqual({
      "contact.phone": "+375290000000",
      "contact.name": "Тестовое лицо",
      "contact.organization_name": "Тестовая компания",
    });
    expect(store.draft.address).toBeNull();
    expect(store.dirty).toBe(false);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
    store.draft.values["listing.description"] = "Квартира";
    store.changed();
    await store.save();
    const write = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(
      JSON.parse(String(write[1]?.body)).draft.values["contact.phone"],
    ).toBe("+375290000000");
    profile.phone = "+375330000000";
    expect(store.draft.values["contact.phone"]).toBe("+375290000000");
    await store.fresh();
    expect(store.draft.values["contact.phone"]).toBe("+375330000000");
    store.destroy();
  });

  it("fills only absent fields in saved cards, respecting custom and cleared contacts", async () => {
    const store = new RentalDraftStore(
      () => "owner",
      () => {},
      () => ({
        phone: "+375290000000",
        contactPerson: "Профиль",
        company: "Компания",
      }),
    );
    store.schema = schema;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          id: "saved",
          revision: 1,
          draft: {
            cardVersion: "test",
            values: { "contact.phone": "", "contact.name": "Другой контакт" },
            platforms: [],
            address: null,
          },
          photos: [],
        }),
      ),
    );
    await store.open("saved");
    expect(store.draft.values).toEqual({
      "contact.phone": "",
      "contact.name": "Другой контакт",
      "contact.organization_name": "Компания",
    });
    expect(store.dirty).toBe(true);
    store.destroy();
  });
});

describe("rental API errors", () => {
  it("explains a proxy error page or an empty body instead of a JSON parse error", async () => {
    for (const [status, body] of [
      [502, "<html><body><h1>502 Bad Gateway</h1></body></html>"],
      [504, ""],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status })),
      );
      await expect(rentalApi("owner", "drafts")).rejects.toThrow(
        `Сервер временно недоступен (код ${status}). Изменения сохранятся при следующей попытке.`,
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ error: "Карточка изменена" }, 409)),
    );
    await expect(rentalApi("owner", "drafts")).rejects.toThrow(
      "Карточка изменена",
    );
  });

  it("keeps unsaved edits and shows the outage message after a failed autosave", async () => {
    vi.useFakeTimers();
    const store = new RentalDraftStore(
      () => "owner",
      () => {},
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    store.draft.values["listing.title"] = "Квартира";
    store.changed();
    await vi.advanceTimersByTimeAsync(1300);
    expect(store.error).toBe(
      "Сервер временно недоступен (код 502). Изменения сохранятся при следующей попытке.",
    );
    expect(store.dirty).toBe(true);
    store.destroy();
  });
});

describe("rental revision conflicts", () => {
  const conflictBody = {
    error: "Карточка изменена в другой вкладке. Сохраните свои правки перед обновлением.",
  };
  it("stops autosaving after 409 until the edits are saved as a copy", async () => {
    vi.useFakeTimers();
    const store = new RentalDraftStore(
      () => "owner",
      () => {},
    );
    const original = store.id,
      calls: { url: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return url.endsWith("/drafts/" + original)
          ? response(conflictBody, 409)
          : response({ revision: 1 });
      }),
    );
    store.revision = 2;
    store.draft.values["listing.title"] = "Моя правка";
    store.changed();
    await vi.advanceTimersByTimeAsync(1300);
    expect(store.conflict).toBe(true);
    expect(store.error).toBe(conflictBody.error);
    calls.length = 0;
    for (const title of ["Ещё", "Ещё правка", "Ещё правка 3"]) {
      store.draft.values["listing.title"] = title;
      store.changed();
      await vi.advanceTimersByTimeAsync(1300);
    }
    expect(calls).toEqual([]);
    await expect(store.flush()).rejects.toThrow("Сохраните копию");
    expect(calls).toEqual([]);
    await store.saveCopy();
    expect(store.conflict).toBe(false);
    expect(store.id).not.toBe(original);
    expect(calls).toEqual([
      {
        url: "/api/workspace/rental/drafts/" + store.id,
        body: expect.objectContaining({ revision: 0 }),
      },
    ]);
    expect(calls[0].body.draft.values["listing.title"]).toBe("Ещё правка 3");
    store.draft.values["listing.title"] = "После копии";
    store.changed();
    await vi.advanceTimersByTimeAsync(1300);
    expect(calls.map((call) => call.url)).toEqual(
      Array(2).fill("/api/workspace/rental/drafts/" + store.id),
    );
    store.destroy();
  });

  it("loads the saved version after confirmation and continues from its revision", async () => {
    let id = "";
    const saved = {
      cardVersion: "test",
      values: { "listing.description": "Сохранённая версия" },
      platforms: ["kufar"],
      address: null,
    };
    const calls: { method?: string; url: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method: init?.method, url, body });
        if (url.endsWith("/editor")) return response(schema);
        if (url.endsWith("/drafts")) return response({ drafts: [] });
        if (url.endsWith("/drafts/" + id) && init?.method === "GET")
          return response({ id, revision: 5, draft: saved, photos: [] });
        return body?.revision === 4
          ? response(conflictBody, 409)
          : response({ revision: body.revision + 1 });
      }),
    );
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance,
      el = fixture.nativeElement as HTMLElement,
      button = (selector: string) =>
        el.querySelector<HTMLButtonElement>(selector)!;
    try {
      await vi.waitFor(() => expect(c.store.schema).not.toBeNull());
      id = c.store.id;
      c.store.revision = 4;
      vi.useFakeTimers();
      c.setDescription("Моя локальная правка");
      await vi.advanceTimersByTimeAsync(1300);
      fixture.detectChanges();
      expect(c.store.conflict).toBe(true);
      expect(button(".conflict .save-copy").textContent).toContain("Сохранить копию");
      button(".conflict .load-saved").click();
      fixture.detectChanges();
      expect(el.querySelector(".load-saved-confirmation")?.textContent).toContain(
        "Ваши несохранённые правки пропадут.",
      );
      expect(c.store.conflict).toBe(true);
      button(".confirm-load-saved").click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(c.store.conflict).toBe(false);
      expect(c.store.dirty).toBe(false);
      expect(c.store.revision).toBe(5);
      expect(c.description).toBe("Сохранённая версия");
      expect(el.querySelector(".conflict")).toBeNull();
      calls.length = 0;
      c.setDescription("Правка поверх сохранённой");
      await vi.advanceTimersByTimeAsync(1300);
      expect(calls.filter((call) => call.method === "POST")).toEqual([
        {
          method: "POST",
          url: "/api/workspace/rental/drafts/" + id,
          body: expect.objectContaining({ revision: 5 }),
        },
      ]);
    } finally {
      fixture.destroy();
    }
  });
  it("asks to update the card fields only when the card model changed, and analyzes with the card version", async () => {
    const card = (cardVersion: string) => ({
      modelVersion: 2,
      cardVersion,
      values: { "listing.description": "Сдам квартиру в Минске, 1500 BYN" },
      platforms: ["kufar"],
      address: null,
    });
    const drafts: Record<string, unknown> = { same: card("test"), older: card("before-test") };
    const analyze: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const id = url.match(/\/drafts\/([^/]+)$/)?.[1];
        if (url.endsWith("/editor")) return response(schema);
        if (url.endsWith("/drafts")) return response({ drafts: [] });
        if (url.endsWith("/analyze")) {
          analyze.push(JSON.parse(String(init?.body)));
          return response({ cardVersion: "test", model: "test", suggestions: [], address: null, questions: [], ignored: 0 });
        }
        if (id && !init?.body) return response({ id, revision: 1, draft: drafts[id], photos: [] });
        return response({ revision: 2 });
      }),
    );
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance,
      el = fixture.nativeElement as HTMLElement,
      update = () =>
        Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent?.trim() === "Обновить поля карточки",
        );
    try {
      await vi.waitFor(() => expect(c.store.schema).not.toBeNull());
      expect(c.store.draft.cardVersion).toBe("test");
      await c.store.open("same");
      fixture.detectChanges();
      expect(c.store.error).toBe("");
      expect(update()).toBeUndefined();
      await c.ai.fillFromDescription();
      expect(analyze).toEqual([{ text: "Сдам квартиру в Минске, 1500 BYN", cardVersion: "test" }]);
      expect(c.ai.message).toBe("Новых сведений не найдено.");
      await c.store.open("older");
      fixture.detectChanges();
      expect(c.store.error).toContain("Правила обновились");
      expect(update()).toBeDefined();
    } finally {
      fixture.destroy();
    }
  });
  it("asks to check old values only for a migrated card that kept them, and does not open an unmigrated one", async () => {
    const card = (legacy: unknown[]) => ({
      modelVersion: 2,
      cardVersion: "test",
      values: { "contact.name": "Анна" },
      platforms: ["kufar"],
      address: null,
      legacy,
    });
    const drafts: Record<string, unknown> = {
      clean: card([]),
      migrated: card([
        { platform: "kufar", field: "kufar.rooms", source: "", value: "5+", candidate: null, message: "Нужно сверить прежнее значение." },
      ]),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const id = url.match(/\/drafts\/([^/]+)$/)?.[1];
        if (url.endsWith("/editor")) return response(schema);
        if (url.endsWith("/drafts")) return response({ drafts: [] });
        if (id === "old" && !init?.body)
          return response({ error: "Карточку нужно перенести командой миграции." }, 409);
        if (id && !init?.body) return response({ id, revision: 1, draft: drafts[id], photos: [] });
        return response({ revision: 2 });
      }),
    );
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance,
      el = fixture.nativeElement as HTMLElement;
    try {
      await vi.waitFor(() => expect(c.store.schema).not.toBeNull());
      await c.store.open("clean");
      fixture.detectChanges();
      expect(el.querySelector(".legacy-section")).toBeNull();
      await c.store.open("migrated");
      fixture.detectChanges();
      expect(el.querySelector(".legacy-section h2")?.textContent).toContain("Сверьте прежние сведения · 1");
      Array.from(el.querySelectorAll<HTMLButtonElement>(".legacy-item button"))
        .find((b) => b.textContent?.includes("Оставить в истории"))!
        .click();
      fixture.detectChanges();
      expect(el.querySelector(".legacy-section")).toBeNull();
      expect(c.store.draft.resolvedLegacy).toHaveLength(1);
      await c.store.open("old");
      fixture.detectChanges();
      expect(c.store.id).not.toBe("old");
      expect(el.querySelector(".error-banner")?.textContent).toContain("Карточку нужно перенести командой миграции.");
    } finally {
      fixture.destroy();
    }
  });
});
