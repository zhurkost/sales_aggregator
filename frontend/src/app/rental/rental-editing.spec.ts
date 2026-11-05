import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalEditorComponent } from "./rental-editor.component";
import { RentalFormStore } from "./rental-form.store";
import type { EditorSchema, Prepared } from "./rental-models";

const schema: EditorSchema = {
  version: "test",
  addressSuggestions: false,
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
        options: [
          "contact.phone",
          "contact.name",
          "contact.organization_name",
        ].map((id) => ({
          id,
          name: id,
          type: "text",
          description: "",
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
        : url.endsWith("/prepare")
            ? { platforms: report }
            : {},
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
  it("keeps the visible report and textarea focus, debouncing rechecks without persistence", async () => {
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
      expect(el.querySelector(".results")).toBe(panel);
      expect(document.activeElement).toBe(input);
      expect(c.store.check.stale).toBe(false);
      expect(input.disabled).toBe(false);
    } finally {
      fixture.destroy();
    }
  });

  it("ignores a late validation response after editing and after changing apartments", async () => {
    vi.useFakeTimers();
    const store = new RentalFormStore(
      () => "owner",
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
    store.card.values["listing.description"] = "Новое описание";
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
});



describe("transient rental form", () => {
  it("keeps header buttons inert and editing never persists or resets the form", async () => {
    const fetch = mockApi();
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.schema).not.toBeNull());
    const c = fixture.componentInstance;
    c.card.values["listing.description"] = "Не терять введённый текст";
    c.changed(); fixture.detectChanges();
    fetch.mockClear(); vi.useFakeTimers();
    const buttons = fixture.nativeElement.querySelectorAll(".header-actions button") as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe("Мои квартиры");
    expect(buttons[1].textContent?.trim()).toBe("＋ Новая");
    buttons[0].click(); buttons[1].click();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).not.toHaveBeenCalled();
    expect(c.panel).toBeNull();
    expect(c.card.values["listing.description"]).toBe("Не терять введённый текст");
    expect(fixture.nativeElement.textContent).not.toContain("Сохранено");
    fixture.destroy();
  });
  it("initializes contacts in memory and does not carry form data into a new editor", async () => {
    const fetch = mockApi();
    const store = new RentalFormStore(() => "owner", () => ({phone:"+375290000000",contactPerson:"Имя"}));
    await store.load();
    expect(store.card.values["contact.phone"]).toBe("+375290000000");
    store.card.values["listing.description"] = "Текущая форма";
    store.changed(); store.destroy();
    const next = new RentalFormStore(() => "owner"); await next.load();
    expect(next.card.values["listing.description"]).toBeUndefined();
    expect(fetch.mock.calls.every(([url]) => url.endsWith("/editor"))).toBe(true);
    next.destroy();
  });
});
