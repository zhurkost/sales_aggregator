import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import { rentalInterceptor } from "./rental-api";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AddressInputComponent } from "./address-input.component";
import { RentalEditorComponent } from "./rental-editor.component";
import { TestBed } from "@angular/core/testing";
import type { EditorSchema, Field, FieldState } from "./rental-models";
// The application's HTTP client: the fetch backend and the rental interceptor.
beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(withFetch(), withInterceptors([rentalInterceptor]))] }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const card = (addressDependentFacts: string[] = [], addressFields: string[] = []): EditorSchema["card"] =>
  ({ version: 2, valueLabels: {}, addressDependentFacts, addressFields, profileDefaults: [] });
const field = (id: string, name = id, type = "text"): Field => ({ id, name, type });
const state = (id: string, transferred = true): FieldState => ({ id, required: false, transferred, choices: [] });
/** The card fields derived from the address in the committed card model. */
const addressFields = ["location.settlement", "location.street", "location.house_number", "location.latitude", "location.longitude"];
/** The body of a request the editor sent. */
const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : null);

describe("rental preparation editor", () => {
  it("locks input during opening and rejects an unexpected late edit without losing it", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => resolve = r)));
    const opening = c.store.open("another");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    const title = field("listing.title", "Title");
    c.setValue(title, "Must not accept locked input");
    expect(c.store.draft.values[title.id]).toBeUndefined();
    c.store.draft.values[title.id] = "Unexpected asynchronous edit";
    c.store.changed();
    resolve(response({id:"another", revision:1, draft:{cardVersion:"1",values:{},platforms:[],address:null}, photos:[]}));
    await opening;
    expect(c.store.id).not.toBe("another");
    expect(c.store.draft.values[title.id]).toBe("Unexpected asynchronous edit");
    expect(c.store.dirty).toBe(true);
    c.ngOnDestroy();
  });
  it("editing nearby landmarks never clears the apartment address", () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.store.draft.address = {provider:"manual", label:"Минск", countryIso:"BY", settlement:"Минск", street:"", house:"", confirmed:false};
    for (const id of ["location.metro_1_station", "location.residential_complex", "location.town_distance"])
      c.setValue(field(id), "Example");
    expect(c.store.draft.address.settlement).toBe("Минск");
    c.ngOnDestroy();
  });
  it("clearing a manual address updates the visible input too", () => {
    const c = TestBed.runInInjectionContext(() => new AddressInputComponent());
    c.search("Manual query"); c.value = null;
    expect(c.query).toBe(""); expect(c.selected).toBeNull(); c.ngOnDestroy();
  });
  it("persists an unselected address query and rejects a late selection while navigating", async () => {
    const c = TestBed.runInInjectionContext(() => new AddressInputComponent());
    const emit = vi.spyOn(c.addressChange, "emit");
    c.search("Тестовый город, дом 7А");
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({label:"Тестовый город, дом 7А", confirmed:false}));
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => resolve = r)));
    const selecting = c.choose("test");
    c.disabled = true;
    resolve(response({address:{label:"Stale",confirmed:true}}));
    await selecting;
    expect(c.query).toBe("Тестовый город, дом 7А");
    c.ngOnDestroy();
  });
  it("invalidates native coordinates and local address dependencies as one operation", () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.store.schema = {card:card(["location.metro"], addressFields), groups:[],cardVersion:"2",addressSuggestions:false,photoLimit:12,
      platforms:{example:{name:"example",labels:{}}}};
    c.store.draft.address = {provider:"dadata",label:"Old",countryIso:"BY",settlement:"Old",street:"Old",house:"1",confirmed:true};
    c.store.draft.values["location.metro"] = "Old metro";
    c.store.draft.values["location.latitude"] = "53.9";
    c.store.draft.values["rental.rooms"] = "2";
    c.addressChanged({provider:"dadata",label:"New",countryIso:"BY",settlement:"New",street:"New",house:"2",confirmed:true});
    expect(c.store.draft.values["location.latitude"]).toBeUndefined();
    expect(c.store.draft.values["location.metro"]).toBeUndefined();
    expect(c.store.draft.values["rental.rooms"]).toBe("2");
    c.ngOnDestroy();
  });
  it("recovers revision conflicts by saving a separate card without overwriting the original", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    const original = c.store.id; c.store.revision = 7; c.store.dirty = true;
    c.store.draft.values["listing.title"] = "Keep my edits";
    const calls: {url:string, body:any}[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({url,body:init?.body ? JSON.parse(String(init.body)) : null});
      return response(url.endsWith("/drafts") ? {drafts:[]} : {revision:1});
    }));
    await c.store.saveCopy();
    expect(c.store.id).not.toBe(original);
    expect(calls[0].body.revision).toBe(0);
    expect(calls[0].body.draft.values["listing.title"]).toBe("Keep my edits");
    expect(calls.some(call => call.url.endsWith(original))).toBe(false);
    c.ngOnDestroy();
  });

  it("renders a fifth marketplace with the same one-field form and preserves data when toggled", async () => {
    const area = field("rental.test", "Площадь тест");
    const platforms = Object.fromEntries(["one","two","three","four","fifth"].map(p => [p, {name:p === "fifth" ? "Пятая площадка" : p,labels:{}}]));
    // Only the fifth platform maps the field: the server shows it while that platform is chosen.
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => response(url.endsWith("/editor") ? {
      cardVersion:"2",card:card(), groups:[{id:"group.main",name:"Главное",fields:[area]}],addressSuggestions:false,photoLimit:12,platforms,
    } : url.endsWith("/fields") ? {fields: body(init).draft.platforms.includes("fifth") ? [state(area.id)] : []} : {drafts:[]})));
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId","test"); fixture.detectChanges();
    const shown = () => { fixture.detectChanges(); return fixture.nativeElement.querySelectorAll('[id="rental-rental.test"]').length; };
    await vi.waitFor(() => {expect(shown()).toBe(1); expect(fixture.nativeElement.textContent).toContain("Пятая площадка");});
    const c = fixture.componentInstance;
    expect(c.store.draft.platforms).toHaveLength(5);
    c.setValue(area,"42,5"); c.store.setPlatform("fifth",false);
    await vi.waitFor(() => expect(shown()).toBe(0));
    c.store.setPlatform("fifth",true);
    await vi.waitFor(() => expect(shown()).toBe(1));
    expect(c.store.draft.values[area.id]).toBe("42,5"); fixture.destroy();
  });
  it("marks a card field no selected platform receives as not transferred yet", async () => {
    // Which platform's form needs each field, as the server knows it from the coverage.
    const forms: Record<string, string[]> = {"listing.title": ["one", "two"], "rental.kitchen_area": ["one"], "location.metro": []};
    const platforms = Object.fromEntries(["one", "two"].map(p => [p, {name: p, labels: {}}]));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => response(url.endsWith("/editor") ? {
      cardVersion: "2", card: card(), addressSuggestions: false, photoLimit: 12, platforms,
      groups: [{id: "group.main", name: "Главное", fields: Object.keys(forms).map(id => field(id))}],
    } : url.endsWith("/fields") ? {fields: Object.entries(forms).map(([id, to]) =>
      state(id, to.some(p => body(init).draft.platforms.includes(p))))} : {drafts: []})));
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "test"); fixture.detectChanges();
    const c = fixture.componentInstance;
    const marked = () => {
      fixture.detectChanges();
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(".field"))
        .filter(f => f.querySelector(".not-transferred")?.textContent?.includes("пока не переносится"))
        .map(f => f.querySelector("input")!.id);
    };
    await vi.waitFor(() => expect(marked()).toEqual(["rental-location.metro"]));
    c.store.setPlatform("one", false);
    await vi.waitFor(() => expect(marked()).toEqual(["rental-rental.kitchen_area", "rental-location.metro"]));
    fixture.destroy();
  });
  it("labels and styles a field by the unit and role the card model gives it, not by its id", async () => {
    const fields = [{...field("rental.total_area", "Общая площадь"), unit: "м²"}, field("rental.area_note", "Заметка"),
      {...field("rental.monthly_price", "Плата за месяц"), role: "price"}, field("rental.deposit", "Залог")];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/editor") ? {cardVersion: "2", card: card(),
      addressSuggestions: false, photoLimit: 12, platforms: {one: {name: "one", labels: {}}}, groups: [{id: "group.main", name: "Главное", fields}]}
      : url.endsWith("/fields") ? {fields: fields.map(f => state(f.id))} : {drafts: []})));
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "test"); fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => { fixture.detectChanges(); expect(el.querySelectorAll(".main-fields .field")).toHaveLength(4); });
    const labels = Array.from(el.querySelectorAll(".main-fields .field label")).map(l => l.textContent!.trim());
    expect(labels).toEqual(["Общая площадь, м²", "Заметка", "Плата за месяц", "Залог"]);
    expect(Array.from(el.querySelectorAll(".main-fields .field.price label")).map(l => l.textContent!.trim())).toEqual(["Плата за месяц"]);
    fixture.destroy();
  });
  it("shows a field that depends on a number exactly when the server does", async () => {
    // The server's answer: separate rooms apply to two rooms and more.
    const rooms = field("rental.room_configuration", "Комнат", "enum"), separate = field("rental.separate_rooms", "Раздельных");
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/fields")) {
        const values = body(init).draft.values;
        requests.push(values);
        return response({fields: [{...state(rooms.id), choices: ["1", "2"]},
          ...(values[rooms.id] === "1" ? [] : [state(separate.id)])]});
      }
      return response(url.endsWith("/editor") ? {cardVersion: "2", card: card(), addressSuggestions: false, photoLimit: 12,
        platforms: {realt: {name: "Realt", labels: {}}}, groups: [{id: "group.main", name: "Главное", fields: [rooms, separate]}]}
        : url.endsWith("/drafts") ? {drafts: []} : {revision: 1});
    }));
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "test"); fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const shown = () => { fixture.detectChanges(); return !!el.querySelector('[id="rental-rental.separate_rooms"]'); };
    await vi.waitFor(() => expect(shown()).toBe(true));
    const select = el.querySelector<HTMLSelectElement>('[id="rental-rental.room_configuration"]')!;
    expect(Array.from(select.options).map(o => o.value)).toEqual(["", "1", "2"]);
    select.value = "1"; select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(shown()).toBe(false), {timeout: 3000});
    expect(requests.at(-1)).toEqual({"rental.room_configuration": "1"});
    fixture.destroy();
  });
  it("groups different native required labels into one canonical correction", () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.store.schema = {cardVersion:"2",card:card(),groups:[{id:"group.main",name:"Main",fields:[field("rental.area","Жилая площадь")]}],addressSuggestions:false,photoLimit:12,platforms:{}};
    c.store.results = ["one","two"].map((platform,i)=>({platform,values:{},checksPassed:false,form:[],manual:[],issues:[{field:platform+".area",source:"rental.area",code:"required",message:i ? "Площадь жилая, м²" : "Жилая площадь"}]}));
    expect(c.view.groupedIssues).toEqual([{source:"rental.area",message:"Заполните «Жилая площадь».",platforms:["one","two"]}]);
    c.ngOnDestroy();
  });
  it("renders delete confirmation, supports cancellation and updates the saved list", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/editor")) return response({
        cardVersion: "1", card: card(), groups: [], addressSuggestions: false, photoLimit: 12,
        platforms: Object.fromEntries(["kufar", "onliner", "realt", "domovita"].map((name) => [name, {
          name, labels: {},
        }])),
      });
      if (url.endsWith("/fields")) return response({ fields: [] });
      if (url.endsWith("/drafts")) return response({ drafts: [{ id: "saved", title: "Тестовая квартира", address: "", revision: 1, publications: [] }] });
      return response({ deleted: true });
    });
    vi.stubGlobal("fetch", fetch);
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId", "owner");
    const element = fixture.nativeElement as HTMLElement;
    try {
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.componentInstance.store.schema).not.toBeNull();
        fixture.componentInstance.openPanel("saved");
        fixture.detectChanges();
        expect(element.querySelector(".saved-row .delete-item")).not.toBeNull();
      });
      const remove = element.querySelector<HTMLButtonElement>(".saved-row .delete-item")!;
      expect(remove.getAttribute("aria-label")).toContain("Тестовая квартира");
      remove.click();
      fixture.detectChanges();
      expect(element.querySelector(".delete-confirmation")?.textContent).toContain("Восстановить её не получится");
      element.querySelector<HTMLButtonElement>(".delete-actions .secondary")!.click();
      fixture.detectChanges();
      expect(element.querySelector(".delete-confirmation")).toBeNull();
      expect(fetch.mock.calls.some(([url]) => url.endsWith("/delete"))).toBe(false);
      remove.click();
      fixture.detectChanges();
      element.querySelector<HTMLButtonElement>(".delete-actions .delete-item")!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(element.querySelector(".rental-saved")).toBeNull();
      });
      expect(element.textContent).toContain("Квартира удалена");
    } finally { fixture.destroy(); }
  });
  it("requires confirmation before removing a saved apartment", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await c.store.remove(c.store.id);
    expect(fetch).not.toHaveBeenCalled();
    expect(c.store.busy).toBe(false);
    c.ngOnDestroy();
  });
  it("waits for an in-flight save and never recreates the deleted active card", async () => {
    vi.useFakeTimers();
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.workspaceId = "owner";
    const id = c.store.id;
    c.store.revision = 1;
    c.store.drafts = [{ id, title: "Apartment", address: "", revision: 1, publications: [] }];
    let finish!: (response: Response) => void;
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/delete")) return response({ deleted: true });
      if (url.endsWith("/drafts")) return response({ drafts: [{ id, title: "Apartment", address: "", revision: 2, publications: [] }] });
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    c.store.changed();
    const saving = c.store.save();
    await Promise.resolve();
    await Promise.resolve();
    c.store.changed();
    const queuedSave = c.store.save();
    c.store.pendingDelete = id;
    const deleting = c.store.remove(id);
    expect(calls.some((call) => call.url.endsWith("/delete"))).toBe(false);
    finish(response({ revision: 2 }));
    await Promise.all([saving, queuedSave, deleting]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.filter((call) => call.url.includes("/drafts/") && call.body?.draft)).toHaveLength(1);
    expect(calls.find((call) => call.url.endsWith("/delete"))?.body).toEqual({ revision: 2 });
    expect(c.store.drafts).toEqual([]);
    expect(c.store.id).not.toBe(id);
    expect(c.store.revision).toBe(0);
    expect(c.store.draft.values).toEqual({});
    expect(c.store.dirty).toBe(false);
    expect(c.store.status).toBe("Квартира удалена");
    c.ngOnDestroy();
  });
  it("keeps another open apartment intact when removing an item from the list", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    const current = c.store.id;
    c.store.draft.values["listing.title"] = "Keep edits";
    c.store.dirty = true;
    c.store.drafts = [{ id: "other", title: "Other", address: "", revision: 4, publications: [] }];
    c.store.pendingDelete = "other";
    vi.stubGlobal("fetch", vi.fn(async () => response({ deleted: true })));
    await c.store.remove("other");
    expect(c.store.drafts).toEqual([]);
    expect(c.store.id).toBe(current);
    expect(c.store.draft.values["listing.title"]).toBe("Keep edits");
    expect(c.store.dirty).toBe(true);
    c.ngOnDestroy();
  });
  it("preserves the card and unsaved edits if deletion fails or conflicts", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    const id = c.store.id;
    c.store.revision = 3;
    c.store.draft.values["listing.title"] = "Keep";
    c.store.dirty = true;
    c.store.drafts = [{ id, title: "Keep", address: "", revision: 3, publications: [] }];
    c.store.pendingDelete = id;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Карточка изменена" }), { status: 409 })));
    await c.store.remove(id);
    expect(c.store.error).toBe("Карточка изменена");
    expect(c.store.id).toBe(id);
    expect(c.store.drafts).toHaveLength(1);
    expect(c.store.draft.values["listing.title"]).toBe("Keep");
    expect(c.store.dirty).toBe(true);
    expect(c.store.busy).toBe(false);
    expect(c.store.deletingId).toBeNull();
    c.ngOnDestroy();
  });
  it("flushes edits made during an in-flight save before leaving", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.workspaceId = "a";
    c.store.changed();
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/drafts")) return response({ drafts: [] });
        writes++;
        if (writes === 1) {
          c.store.draft.values["listing.title"] = "Latest";
          c.store.changed();
        }
        return response({ revision: writes });
      }),
    );
    await c.store.flush();
    expect(writes).toBe(2);
    expect(c.store.dirty).toBe(false);
    c.ngOnDestroy();
  });
  it("keeps the new query when clearing a previous address and resets on another draft", () => {
    const c = TestBed.runInInjectionContext(() => new AddressInputComponent());
    c.draftId = "one";
    c.value = {
      provider: "dadata",
      label: "Old",
      countryIso: "BY",
      settlement: "Old",
      street: "",
      house: "",
      confirmed: true,
    };
    c.search("New");
    c.value = c.selected;
    expect(c.query).toBe("New");
    c.draftId = "two";
    expect(c.query).toBe("");
    c.ngOnDestroy();
  });
  it("ignores a stale address response after the query changes", async () => {
    const c = TestBed.runInInjectionContext(() => new AddressInputComponent());
    c.workspaceId = "owner";
    let finish!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((r) => (finish = r))),
    );
    const load = c.load("Минск", 0);
    c.search("Брест");
    finish(response({ suggestions: [{ id: "old", label: "Минск" }] }));
    await load;
    expect(c.suggestions).toEqual([]);
    expect(c.query).toBe("Брест");
    c.ngOnDestroy();
  });
  it("does not select the first address automatically", async () => {
    const c = TestBed.runInInjectionContext(() => new AddressInputComponent());
    c.workspaceId = "owner";
    const emit = vi.spyOn(c.addressChange, "emit");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ suggestions: [{ id: "a", label: "Address" }] }),
      ),
    );
    await c.load("Address", 0);
    expect(emit).not.toHaveBeenCalled();
    expect(c.selected).toBeNull();
    c.ngOnDestroy();
  });
  it("opens manual components from an unresolved AI address and resets for another card", async () => {
    const fixture = TestBed.createComponent(AddressInputComponent);
    fixture.componentRef.setInput("workspaceId", "test");
    fixture.componentRef.setInput("draftId", "one");
    fixture.componentRef.setInput("value", {provider:"manual",countryIso:"BY",label:"город Минск, ул. Брикета, дом 18",settlement:"город Минск",street:"ул. Брикета",house:"18",confirmed:false,resolution:"not_found"});
    fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLInputElement>('[aria-label="Населённый пункт"]')?.value).toBe("город Минск");
    expect(element.querySelector<HTMLInputElement>('[aria-label="Улица"]')?.value).toBe("ул. Брикета");
    expect(element.querySelector<HTMLInputElement>('[aria-label="Дом, включая букву"]')?.value).toBe("18");
    fixture.componentRef.setInput("draftId", "two");fixture.componentRef.setInput("value", null);fixture.detectChanges();
    expect(fixture.componentInstance.manual).toBe(false);fixture.destroy();
  });
  it("drops provider identity and coordinates after manual address editing", () => {
    const c = TestBed.runInInjectionContext(() => new AddressInputComponent());
    c.value = {provider:"dadata",countryIso:"BY",label:"Минск, Брикета, 18",settlement:"Минск",street:"Брикета",house:"18",confirmed:true,resolution:"matched",sourceId:"way:25439815",confirmedAt:"2026-11-03",latitude:"53.9",longitude:"27.4"};
    c.manual = true;c.setPart("house", "19");
    expect(c.selected?.provider).toBe("manual");expect(c.selected?.confirmed).toBe(false);
    expect(c.selected?.sourceId).toBeUndefined();expect(c.selected?.latitude).toBe("");c.ngOnDestroy();
  });
  it("invalidates coordinates when the confirmed address changes", () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.store.schema = {card:card([], addressFields), groups:[], cardVersion:"2", addressSuggestions:false, photoLimit:12, platforms:{}};
    c.store.draft.address = {
      provider: "dadata",
      label: "Old",
      countryIso: "BY",
      settlement: "Old",
      street: "Old",
      house: "1",
      confirmed: true,
    };
    c.store.draft.values["location.latitude"] = "53.9";
    c.addressChanged(null);
    expect(c.store.draft.values["location.latitude"]).toBeUndefined();
    expect(c.store.draft.address).toBeNull();
    c.ngOnDestroy();
  });
  it("does not lose edits made during a save and pins workspace", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.workspaceId = "original";
    c.store.changed();
    let finish!: (r: Response) => void;
    const fetch = vi.fn((url: string, init?: RequestInit) =>
      url.endsWith("/drafts")
        ? Promise.resolve(response({ drafts: [] }))
        : new Promise<Response>((r) => (finish = r)),
    );
    vi.stubGlobal("fetch", fetch);
    const save = c.store.save();
    await Promise.resolve();
    await Promise.resolve();
    c.store.draft.values["listing.title"] = "New";
    c.store.changed();
    finish(response({ revision: 1 }));
    await save;
    expect(c.store.dirty).toBe(true);
    expect(c.store.revision).toBe(1);
    expect(
      (fetch.mock.calls[0][1]?.headers as Record<string, string>)[
        "X-Autopost-Workspace"
      ],
    ).toBe("original");
    c.ngOnDestroy();
  });
  it("keeps conflicting edits instead of resetting the form", async () => {
    const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
    c.workspaceId = "a";
    c.store.draft.values["listing.title"] = "Keep";
    c.store.changed();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Конфликт" }), { status: 409 }),
      ),
    );
    await expect(c.store.save()).rejects.toThrow("Конфликт");
    expect(c.store.dirty).toBe(true);
    expect(c.store.draft.values["listing.title"]).toBe("Keep");
    c.ngOnDestroy();
  });
  describe("nearby facts follow the confirmed house", () => {
    const facts = ["location.metro_1_station", "location.residential_complex"];
    const house = (n: number, confirmed = true) => ({provider: confirmed ? "dadata" : "manual", label:`Минск, ул Брикета, д ${n}`, countryIso:"BY",
      settlement:"Минск", street:"ул Брикета", house:String(n), confirmed, latitude:"53.9", longitude:"27.5"});
    const typed = (label: string) => ({provider:"manual", label, countryIso:"BY", settlement:"", street:"", house:"", confirmed:false});
    function editor() {
      const c = TestBed.runInInjectionContext(() => new RentalEditorComponent());
      c.store.schema = {card:card(facts, addressFields), cardVersion:"2", addressSuggestions:true,photoLimit:12,
        groups:[{id:"group.near",name:"Рядом с домом",fields:[field(facts[0], "Метро"), field(facts[1], "Жилой комплекс")]}],
        platforms:{example:{name:"example",labels:{}}}};
      c.store.draft.address = house(18);
      c.store.draft.values = {[facts[0]]:"Немига", [facts[1]]:"Новая Боровая", "location.latitude":"53.9"};
      c.store.draft.aiEvidence = {[facts[0]]:"рядом метро Немига"};
      return c;
    }
    it("typing in the search and editing parts keep nearby facts but drop coordinates", () => {
      const c = editor();
      for (const text of ["М", "Минск, Брик", "Минск, Брикета 1"]) c.addressChanged(typed(text));
      c.addressChanged({...house(19), provider:"manual", confirmed:false});
      expect(c.store.draft.values[facts[0]]).toBe("Немига");
      expect(c.store.draft.values[facts[1]]).toBe("Новая Боровая");
      expect(c.store.draft.aiEvidence?.[facts[0]]).toBe("рядом метро Немига");
      expect(c.store.draft.values["location.latitude"]).toBeUndefined();
      expect(c.resetFacts).toBeNull();
      c.addressChanged(house(18));
      expect(c.store.draft.values[facts[0]]).toBe("Немига");
      c.ngOnDestroy();
    });
    it("another confirmed house resets them once and Вернуть restores them", () => {
      const c = editor();
      c.addressChanged(typed("Минск, Брикета 2"));
      c.addressChanged(house(20));
      expect(c.store.draft.values[facts[0]]).toBeUndefined();
      expect(c.store.draft.values[facts[1]]).toBeUndefined();
      expect(c.resetFacts?.names).toEqual(["Метро", "Жилой комплекс"]);
      c.store.dirty = false;
      c.restoreFacts();
      expect(c.store.draft.values[facts[0]]).toBe("Немига");
      expect(c.store.draft.values[facts[1]]).toBe("Новая Боровая");
      expect(c.store.draft.aiEvidence?.[facts[0]]).toBe("рядом метро Немига");
      expect(c.store.draft.address?.house).toBe("20");
      expect(c.resetFacts).toBeNull();
      expect(c.store.dirty).toBe(true);
      c.addressChanged(house(20));
      expect(c.store.draft.values[facts[0]]).toBe("Немига");
      c.ngOnDestroy();
    });
    it("the restore offer lasts until the next address change", () => {
      const c = editor();
      c.addressChanged(house(20));
      expect(c.resetFacts).not.toBeNull();
      c.addressChanged(typed("Минск"));
      expect(c.resetFacts).toBeNull();
      c.restoreFacts();
      expect(c.store.draft.values[facts[0]]).toBeUndefined();
      c.ngOnDestroy();
    });
    it("clearing the address resets them", () => {
      for (const empty of [null, typed("")]) {
        const c = editor();
        c.addressChanged(empty);
        expect(c.store.draft.values[facts[0]]).toBeUndefined();
        expect(c.resetFacts?.names).toEqual(["Метро", "Жилой комплекс"]);
        c.ngOnDestroy();
      }
    });
    it("shows what was reset with a Вернуть button", async () => {
      const prepared = editor();
      prepared.ngOnDestroy();
      vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/editor") ? prepared.store.schema : url.endsWith("/fields") ? {fields: []} : {drafts: []})));
      const fixture = TestBed.createComponent(RentalEditorComponent);
      fixture.componentRef.setInput("workspaceId", "owner");
      fixture.detectChanges();
      const c = fixture.componentInstance;
      await vi.waitFor(() => expect(c.store.schema?.cardVersion).toBe("2"));
      c.store.draft.address = prepared.store.draft.address;
      Object.assign(c.store.draft.values, prepared.store.draft.values);
      c.addressChanged(house(20));
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".reset-facts")?.textContent).toContain("Сброшены сведения рядом с домом: Метро, Жилой комплекс");
      const restore = Array.from(el.querySelectorAll<HTMLButtonElement>(".reset-facts button")).find(b => b.textContent?.trim() === "Вернуть")!;
      restore.click();
      fixture.detectChanges();
      expect(el.querySelector(".reset-facts")).toBeNull();
      expect(c.store.draft.values[facts[0]]).toBe("Немига");
      fixture.destroy();
    });
  });
  describe("address suggestions from the keyboard", () => {
    const suggestions = [{id:"a", label:"Минск, ул Брикета, д 18"}, {id:"b", label:"Минск, ул Брикета, д 19"}];
    async function render() {
      vi.useFakeTimers();
      const calls: {url: string; body: any}[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({url, body});
        return response(url.endsWith("/address/suggest") ? {suggestions}
          : {address:{provider:"dadata", label:suggestions.find(s => s.id === body.id)!.label, countryIso:"BY", settlement:"Минск", street:"ул Брикета", house:"18", confirmed:true}});
      }));
      const fixture = TestBed.createComponent(AddressInputComponent);
      fixture.componentRef.setInput("workspaceId", "owner");
      fixture.componentRef.setInput("value", null);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement, input = el.querySelector<HTMLInputElement>("#rental-address")!;
      const emitted: unknown[] = [];
      fixture.componentInstance.addressChange.subscribe(a => emitted.push(a));
      const type = async (text: string) => {
        input.value = text; input.dispatchEvent(new Event("input"));
        await vi.advanceTimersByTimeAsync(400); fixture.detectChanges();
      };
      const key = async (name: string) => {
        const event = new KeyboardEvent("keydown", {key:name, bubbles:true, cancelable:true});
        input.dispatchEvent(event); await vi.advanceTimersByTimeAsync(0); fixture.detectChanges();
        return event;
      };
      const options = () => Array.from(el.querySelectorAll<HTMLElement>('[role="option"]'));
      return {fixture, el, input, calls, emitted, type, key, options};
    }
    it("is a combobox whose arrows move the active option without choosing the first one", async () => {
      const {fixture, el, input, calls, type, key, options} = await render();
      await type("Минск, Брикета");
      const list = el.querySelector('[role="listbox"]')!;
      expect(input.getAttribute("role")).toBe("combobox");
      expect(input.getAttribute("aria-expanded")).toBe("true");
      expect(input.getAttribute("aria-controls")).toBe(list.id);
      expect(options()).toHaveLength(2);
      expect(input.getAttribute("aria-activedescendant")).toBeNull();
      expect(options().map(o => o.getAttribute("aria-selected"))).toEqual(["false", "false"]);
      expect((await key("Enter")).defaultPrevented).toBe(false);
      expect(calls.some(c => c.url.endsWith("/address/select"))).toBe(false);
      expect((await key("ArrowDown")).defaultPrevented).toBe(true);
      expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);
      expect(options()[0].getAttribute("aria-selected")).toBe("true");
      await key("ArrowDown");
      expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);
      await key("ArrowDown");
      expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);
      await key("ArrowUp");
      expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);
      fixture.destroy();
    });
    it("Enter chooses the active option", async () => {
      const {fixture, input, calls, emitted, type, key, options} = await render();
      await type("Минск, Брикета");
      await key("ArrowDown"); await key("ArrowDown");
      expect((await key("Enter")).defaultPrevented).toBe(true);
      expect(calls.filter(c => c.url.endsWith("/address/select")).map(c => c.body)).toEqual([{id:"b"}]);
      expect(emitted.at(-1)).toEqual(expect.objectContaining({label:"Минск, ул Брикета, д 19", confirmed:true}));
      expect(options()).toHaveLength(0);
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(input.getAttribute("aria-activedescendant")).toBeNull();
      fixture.destroy();
    });
    it("Escape closes the list without choosing", async () => {
      const {fixture, input, calls, emitted, type, key, options} = await render();
      await type("Минск, Брикета");
      await key("ArrowDown");
      const count = emitted.length;
      expect((await key("Escape")).defaultPrevented).toBe(true);
      expect(options()).toHaveLength(0);
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(input.getAttribute("aria-activedescendant")).toBeNull();
      await key("Enter");
      expect(calls.some(c => c.url.endsWith("/address/select"))).toBe(false);
      expect(emitted).toHaveLength(count);
      expect(input.value).toBe("Минск, Брикета");
      fixture.destroy();
    });
  });
});
