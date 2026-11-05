import { describe, it, expect, vi, afterEach } from "vitest";
import { AddressInputComponent } from "./address-input.component";
import { RentalEditorComponent } from "./rental-editor.component";
import { TestBed } from "@angular/core/testing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

describe("rental preparation editor", () => {
  it("editing nearby landmarks never clears the apartment address", () => {
    const c = new RentalEditorComponent();
    c.card.address = {provider:"manual", label:"Минск", countryIso:"BY", settlement:"Минск", street:"", house:"", confirmed:false};
    for (const id of ["location.metro_1_station", "location.residential_complex", "location.town_distance"])
      c.setValue({id, name:id, type:"text", options:[], description:""}, "Example");
    expect(c.card.address.settlement).toBe("Минск");
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
    c.schema = {card:{version:2,addressDependentFacts:["location.metro"]}, category:{options:[]},canonicalValues:{},version:"2",addressSuggestions:false,
      platforms:{example:{labels:{},choiceLabels:{},addressBoundFields:["nativeAddress","coordinates"]}}};
    c.card.values["location.metro"] = "Old metro";
    c.card.extras.example = {nativeAddress:"Old",coordinates:"1,2",other:"Keep"};
    c.addressChanged({provider:"manual",label:"New",countryIso:"BY",settlement:"New",street:"",house:"",confirmed:false});
    expect(c.card.extras.example).toEqual({other:"Keep"});
    expect(c.card.values["location.metro"]).toBeUndefined();
    c.ngOnDestroy();
  });

  it("renders a fifth marketplace with the same one-field form and preserves data when toggled", async () => {
    const field = {id:"rental.test", name:"Площадь тест", type:"text", options:[], description:"", uses:[{platform:"fifth",target:"area"}]};
    const platforms = Object.fromEntries(["one","two","three","four","fifth"].map(p => [p, {name:p === "fifth" ? "Пятая площадка" : p,labels:{},choiceLabels:{},}]));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(url.endsWith("/editor") ? {
      version:"2",card:{version:2,addressDependentFacts:[]}, category:{options:[{id:"group.main",name:"Главное",type:"group",options:[field],description:""}]},canonicalValues:{},addressSuggestions:false,platforms,
    } : {})));
    const fixture = TestBed.createComponent(RentalEditorComponent);
    fixture.componentRef.setInput("workspaceId","test"); fixture.detectChanges();
    await vi.waitFor(() => {fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain("Пятая площадка");});
    const c = fixture.componentInstance;
    expect(c.card.platforms).toHaveLength(5);
    c.setValue(field,"42,5"); c.togglePlatform("fifth",false); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[id="rental-rental.test"]')).toBeNull();
    c.togglePlatform("fifth",true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[id="rental-rental.test"]')).toHaveLength(1);
    expect(c.card.values[field.id]).toBe("42,5"); fixture.destroy();
  });
  it("groups different native required labels into one canonical correction", () => {
    const c = new RentalEditorComponent();
    c.schema = {version:"2",category:{options:[{id:"group.main",name:"Main",type:"group",description:"",options:[{id:"rental.area",name:"Жилая площадь",type:"text",options:[],description:"",}]}]},canonicalValues:{},addressSuggestions:false,platforms:{}};
    c.results = ["one","two"].map((platform,i)=>({platform,values:{},dataReady:false,publicationReady:false,issues:[{field:platform+".area",source:"rental.area",code:"required",message:i ? "Площадь жилая, м²" : "Жилая площадь"}]}));
    expect(c.groupedIssues).toEqual([{source:"rental.area",message:"Заполните «Жилая площадь».",platforms:["one","two"]}]);
    c.ngOnDestroy();
  });
  it("keeps the new query when clearing a previous address and resets on another card", () => {
    const c = new AddressInputComponent();
    c.sessionId = "one";
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
    c.sessionId = "two";
    expect(c.query).toBe("");
    c.ngOnDestroy();
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
    fixture.componentRef.setInput("sessionId", "one");
    fixture.componentRef.setInput("value", {provider:"manual",countryIso:"BY",label:"город Минск, ул. Брикета, дом 18",settlement:"город Минск",street:"ул. Брикета",house:"18",confirmed:false,resolution:"not_found"});
    fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLInputElement>('[aria-label="Населённый пункт"]')?.value).toBe("город Минск");
    expect(element.querySelector<HTMLInputElement>('[aria-label="Улица"]')?.value).toBe("ул. Брикета");
    expect(element.querySelector<HTMLInputElement>('[aria-label="Дом, включая букву"]')?.value).toBe("18");
    fixture.componentRef.setInput("sessionId", "two");fixture.componentRef.setInput("value", null);fixture.detectChanges();
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
    c.card.address = {
      provider: "dadata",
      label: "Old",
      countryIso: "BY",
      settlement: "Old",
      street: "Old",
      house: "1",
      confirmed: true,
    };
    c.card.values["location.latitude"] = "53.9";
    c.addressChanged(null);
    expect(c.card.values["location.latitude"]).toBeUndefined();
    expect(c.card.address).toBeNull();
    c.ngOnDestroy();
  });
  it("keeps typed numeric text exact until server conversion", () => {
    const c = new RentalEditorComponent();
    const field = {
      id: "amount",
      name: "Amount",
      description: "",
      type: "number",
      options: [],
    };
    c.setValue(field, "1,123456789012345678");
    expect(c.card.values["amount"]).toBe("1,123456789012345678");
    c.ngOnDestroy();
  });
});
