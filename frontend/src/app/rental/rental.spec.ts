import { describe, it, expect, vi, afterEach } from "vitest";
import { AddressInputComponent } from "./address-input.component";
import { RentalEditorComponent } from "./rental-editor.component";
import { applicable } from "./conditions";
import { TestBed } from "@angular/core/testing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

describe("rental preparation editor", () => {
  it("locks input during opening and rejects an unexpected late edit without losing it", async () => {
    const c = new RentalEditorComponent();
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => resolve = r)));
    const opening = c.store.open("another");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    const field = {id:"listing.title", type:"text", name:"Title", description:"", options:[], fill_rule:{}};
    c.setValue(field, "Must not accept locked input");
    expect(c.store.draft.values[field.id]).toBeUndefined();
    c.store.draft.values[field.id] = "Unexpected asynchronous edit";
    c.store.changed();
    resolve(response({id:"another", revision:1, draft:{schemaVersion:"1",values:{},platforms:[],address:null}}));
    await opening;
    expect(c.store.id).not.toBe("another");
    expect(c.store.draft.values[field.id]).toBe("Unexpected asynchronous edit");
    expect(c.store.dirty).toBe(true);
    c.ngOnDestroy();
  });
  it("editing nearby landmarks never clears the apartment address", () => {
    const c = new RentalEditorComponent();
    c.store.draft.address = {provider:"manual", label:"Минск", countryIso:"BY", settlement:"Минск", street:"", house:"", confirmed:false};
    for (const id of ["location.metro_1_station", "location.residential_complex", "location.town_distance"])
      c.setValue({id, name:id, type:"text", options:[], fill_rule:{}, description:""}, "Example");
    expect(c.store.draft.address.settlement).toBe("Минск");
    c.ngOnDestroy();
  });
  it("clearing a manual address updates the visible input too", () => {
    const c = new AddressInputComponent();
    c.search("Manual query"); c.value = null;
    expect(c.query).toBe(""); expect(c.selected).toBeNull(); c.ngOnDestroy();
  });
  it("persists an unselected address query and rejects a late selection while navigating", async () => {
    const c = new AddressInputComponent();
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
    const c = new RentalEditorComponent();
    c.store.schema = {card:{version:2,addressDependentFacts:["location.metro"]}, category:{options:[]},canonicalValues:{},version:"2",addressSuggestions:false,
      platforms:{example:{labels:{},choiceLabels:{},constants:{},bindings:[]}}};
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
    const c = new RentalEditorComponent();
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
    const field = {id:"rental.test", name:"Площадь тест", type:"text", options:[], fill_rule:{}, description:"", uses:[{platform:"fifth",target:"area"}]};
    const platforms = Object.fromEntries(["one","two","three","four","fifth"].map(p => [p, {name:p === "fifth" ? "Пятая площадка" : p,labels:{},choiceLabels:{},constants:{},bindings:[]}]));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/editor") ? {
      version:"2",card:{version:2,addressDependentFacts:[]}, category:{options:[{id:"group.main",name:"Главное",type:"group",options:[field],fill_rule:{},description:""}]},canonicalValues:{},addressSuggestions:false,platforms,
    } : {drafts:[]})));
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId","test"); fixture.detectChanges();
    await vi.waitFor(() => {fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain("Пятая площадка");});
    const c = fixture.componentInstance;
    expect(c.store.draft.platforms).toHaveLength(5);
    c.setValue(field,"42,5"); c.togglePlatform("fifth",false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[id="rental-rental.test"]')).toBeNull();
    c.togglePlatform("fifth",true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[id="rental-rental.test"]')).toHaveLength(1);
    expect(c.store.draft.values[field.id]).toBe("42,5"); fixture.destroy();
  });
  it("groups different native required labels into one canonical correction", () => {
    const c = new RentalEditorComponent();
    c.store.schema = {version:"2",category:{options:[{id:"group.main",name:"Main",type:"group",description:"",fill_rule:{},options:[{id:"rental.area",name:"Жилая площадь",type:"text",options:[],description:"",fill_rule:{}}]}]},canonicalValues:{},addressSuggestions:false,platforms:{}};
    c.store.results = ["one","two"].map((platform,i)=>({platform,values:{},dataReady:false,publicationReady:false,issues:[{field:platform+".area",source:"rental.area",code:"required",message:i ? "Площадь жилая, м²" : "Жилая площадь"}]}));
    expect(c.view.groupedIssues).toEqual([{source:"rental.area",message:"Заполните «Жилая площадь».",platforms:["one","two"]}]);
    c.ngOnDestroy();
  });
  it("renders delete confirmation, supports cancellation and updates the saved list", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/editor")) return response({
        version: "1", category: { options: [] }, canonicalValues: {}, addressSuggestions: false,
        platforms: Object.fromEntries(["kufar", "onliner", "realt", "domovita"].map((name) => [name, {
          labels: {}, choiceLabels: {}, constants: {}, bindings: [],
        }])),
      });
      if (url.endsWith("/drafts")) return response({ drafts: [{ id: "saved", title: "Тестовая квартира", address: "", revision: 1 }] });
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
    const c = new RentalEditorComponent();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await c.store.remove(c.store.id);
    expect(fetch).not.toHaveBeenCalled();
    expect(c.store.busy).toBe(false);
    c.ngOnDestroy();
  });
  it("waits for an in-flight save and never recreates the deleted active card", async () => {
    vi.useFakeTimers();
    const c = new RentalEditorComponent();
    c.workspaceId = "owner";
    const id = c.store.id;
    c.store.revision = 1;
    c.store.drafts = [{ id, title: "Apartment", address: "", revision: 1 }];
    let finish!: (response: Response) => void;
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/delete")) return response({ deleted: true });
      if (url.endsWith("/drafts")) return response({ drafts: [{ id, title: "Apartment", address: "", revision: 2 }] });
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
    expect(calls.filter((call) => call.body?.draft)).toHaveLength(1);
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
    const c = new RentalEditorComponent();
    const current = c.store.id;
    c.store.draft.values["listing.title"] = "Keep edits";
    c.store.dirty = true;
    c.store.drafts = [{ id: "other", title: "Other", address: "", revision: 4 }];
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
    const c = new RentalEditorComponent();
    const id = c.store.id;
    c.store.revision = 3;
    c.store.draft.values["listing.title"] = "Keep";
    c.store.dirty = true;
    c.store.drafts = [{ id, title: "Keep", address: "", revision: 3 }];
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
    const c = new RentalEditorComponent();
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
    const c = new AddressInputComponent();
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
  it("keeps dependent choices unknown until their typed prerequisite is chosen", () => {
    const condition = {
      not: { option_id: "owner", operator: "equals", value: true },
    };
    expect(applicable(condition, {})).toBeNull();
    expect(applicable(condition, { owner: false })).toBe(true);
    expect(
      applicable(
        { option_id: "town", operator: "equals", value: 5 },
        { town: "5" },
      ),
    ).toBe(false);
    expect(
      applicable(
        { option_id: "town", operator: "equals", value: 5 },
        { town: 5 },
      ),
    ).toBe(true);
  });
  it("ignores a stale address response after the query changes", async () => {
    const c = new AddressInputComponent();
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
    const c = new AddressInputComponent();
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
    const c = new AddressInputComponent();
    c.value = {provider:"dadata",countryIso:"BY",label:"Минск, Брикета, 18",settlement:"Минск",street:"Брикета",house:"18",confirmed:true,resolution:"matched",sourceId:"way:25439815",confirmedAt:"2026-11-03",latitude:"53.9",longitude:"27.4"};
    c.manual = true;c.setPart("house", "19");
    expect(c.selected?.provider).toBe("manual");expect(c.selected?.confirmed).toBe(false);
    expect(c.selected?.sourceId).toBeUndefined();expect(c.selected?.latitude).toBe("");c.ngOnDestroy();
  });
  it("invalidates coordinates when the confirmed address changes", () => {
    const c = new RentalEditorComponent();
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
    const c = new RentalEditorComponent();
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
    const c = new RentalEditorComponent();
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
      const c = new RentalEditorComponent();
      c.store.schema = {card:{version:2,addressDependentFacts:facts}, canonicalValues:{}, version:"2", addressSuggestions:true,
        category:{options:[{id:"group.near",name:"Рядом с домом",type:"group",description:"",fill_rule:{},options:[
          {id:facts[0],name:"Метро",type:"text",description:"",fill_rule:{},options:[]},
          {id:facts[1],name:"Жилой комплекс",type:"text",description:"",fill_rule:{},options:[]}]}]},
        platforms:{example:{labels:{},choiceLabels:{},constants:{},bindings:[]}}};
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
      vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/editor") ? prepared.store.schema : {drafts: []})));
      const fixture = TestBed.createComponent(RentalEditorComponent);
      fixture.componentRef.setInput("workspaceId", "owner");
      fixture.detectChanges();
      const c = fixture.componentInstance;
      await vi.waitFor(() => expect(c.store.schema?.version).toBe("2"));
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
