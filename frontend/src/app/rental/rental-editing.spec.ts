import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalEditorComponent } from "./rental-editor.component";
import { RentalDraftStore } from "./rental-draft.store";
import { rentalApi } from "./rental-api";
import type { EditorSchema, Prepared } from "./rental-models";

const schema: EditorSchema = {
  version: "test",
  addressSuggestions: false,
  canonicalValues: {},
  card: {
    version: 2,
    expandedGroups: [],
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
      extras: [],
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
    dataReady: false,
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
  it("keeps the visible report and textarea focus, debouncing saves and rechecks", async () => {
    const fetch = mockApi();
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    const c = fixture.componentInstance;
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(c.schema).not.toBeNull();
      });
      await c.prepare();
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
      expect(c.status).toBe("Сохранено");
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
      await vi.waitFor(() => expect(c.drafts).toEqual([other]));
      fetch.mockClear();
      vi.useFakeTimers();
      for (const title of ["Квартира", "Квартира у метро", "Квартира у метро Немига"]) {
        c.draft.values["listing.title"] = title;
        c.changed();
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
      ).toEqual(Array(4).fill(`POST /api/workspace/rental/drafts/${c.id}`));
      expect(c.drafts).toEqual([
        {
          id: c.id,
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
    await c.prepare();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ error: "Временно недоступно" }, 503)),
    );
    await c.store.check.refresh();
    expect(c.results).toEqual(report);
    expect(c.store.check.stale).toBe(true);
    expect(c.store.check.error).toBe("Временно недоступно");
    expect(c.busy).toBe(false);
    mockApi();
    await c.prepare();
    expect(c.store.check.stale).toBe(false);
    expect(c.store.check.error).toBe("");
    c.ngOnDestroy();
  });

  it("keeps validation separate from a failed save", async () => {
    vi.useFakeTimers();
    const c = new RentalEditorComponent();
    c.changed();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/prepare")
          ? response({ platforms: report })
          : response({ error: "Не удалось сохранить" }, 503),
      ),
    );
    await c.prepare();
    expect(c.results).toEqual(report);
    expect(c.error).toBe("Не удалось сохранить");
    expect(c.dirty).toBe(true);
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
            schemaVersion: "test",
            values: { "contact.phone": "", "contact.name": "Другой контакт" },
            extras: {},
            platforms: [],
            address: null,
          },
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
