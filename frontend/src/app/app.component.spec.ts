import { Component, Input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppComponent } from "./app.component";
import { RentalEditorComponent } from "./rental/rental-editor.component";

@Component({selector:"app-rental-editor", standalone:true, template:"<p>Rental editor</p>"})
class RentalStub {
  @Input() category = "";
  @Input() deal: "rent" | "sale" = "rent";
  @Input() objectKind: "apartment" | "house" = "apartment";
  @Input() workspaceId = "";
  @Input() profileDefaults = {};
}
const profile = {id:"owner",name:"Owner",login:"owner"};
const response = (body: unknown) => new Response(JSON.stringify(body),{status:200});
describe("Real estate workspace",()=>{
  let app: AppComponent;
  afterEach(()=>{app?.ngOnDestroy();vi.unstubAllGlobals();vi.restoreAllMocks();sessionStorage.clear();});
  it("restores the selected category after reload for the same profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) =>
      response(url === "/api/workspace/session" ? {profile, profiles:[profile]} : {settings:{}})));
    app = new AppComponent();
    vi.spyOn(app, "checkExtension").mockResolvedValue();
    await app.session();
    app.selectDeal("sale");
    app.ngOnDestroy();
    app = new AppComponent();
    vi.spyOn(app, "checkExtension").mockResolvedValue();
    await app.session();
    expect(app.deal).toBe("sale");
    app.selectDeal("house-rent");
    await app.session();
    expect(app.deal).toBe("house-rent");
    app.selectDeal("rent");
    await app.session();
    expect(app.deal).toBe("rent");
    sessionStorage.setItem("autopost.active-deal.owner", "unrecognized");
    await app.session();
    expect(app.deal).toBe("rent");
  });
  it("opens rental directly and never requests removed workspace APIs",async()=>{
    const fetcher=vi.fn(async(url:unknown)=>{
      if(url==="/api/workspace/session")return response({profile,profiles:[profile]});
      if(url==="/api/workspace/settings")return response({settings:{phone:"+375291234567"}});
      throw new Error("Unexpected request: "+url);
    });
    vi.stubGlobal("fetch",fetcher);
    TestBed.configureTestingModule({imports:[AppComponent]}).overrideComponent(AppComponent,{
      remove:{imports:[RentalEditorComponent]},add:{imports:[RentalStub]},
    });
    const fixture=TestBed.createComponent(AppComponent);app=fixture.componentInstance;
    vi.spyOn(app,"checkExtension").mockResolvedValue();
    const load=vi.spyOn(app,"session");
    fixture.detectChanges();await load.mock.results[0].value;fixture.detectChanges();
    const nav=fixture.nativeElement.querySelector('nav');
    expect(nav.querySelectorAll('button')).toHaveLength(1);
    expect(nav.textContent.trim()).toBe("Недвижимость");
    expect(fixture.nativeElement.querySelector('app-rental-editor')).not.toBeNull();
    for(const label of ["Новое объявление","Очередь и уведомления","Команда","Массовая загрузка","Справочник площадок","Интеграции"])
      expect(fixture.nativeElement.textContent).not.toContain(label);
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(["/api/workspace/session","/api/workspace/settings"]);
  });
  it("fills sale fields from analysis and preserves each tab independently", async () => {
    const schema = {version:"1", category:{options:[]}, canonicalValues:{}, platforms:{one:{name:"Площадка", labels:{}, choiceLabels:{}}}};
    const fetcher = vi.fn(async (url: unknown) => {
      if (url === "/api/workspace/session") return response({profile, profiles:[profile]});
      if (url === "/api/workspace/settings") return response({settings:{}});
      if (url === "/api/workspace/categories/apartments_long_term_rent/editor") return response({...schema, publicationEnabled:true});
      if (url === "/api/workspace/categories/apartments_sale/editor") return response({...schema, publicationEnabled:true,
        category:{options:[{id:"group.sale", name:"Сделка", options:[{id:"sale.price", name:"Цена квартиры", type:"number", options:[]}]}]},
        card:{version:2, addressDependentFacts:[], mainFields:["sale.price"]}});
      if (url === "/api/workspace/categories/apartments_sale/analyze") return response({schemaVersion:"1",
        suggestions:[{field:"sale.price", value:"85000", quote:"85 000 USD"}], questions:[]});
      if (url === "/api/workspace/categories/houses_long_term_rent/editor") return response({...schema, publicationEnabled:true,
        category:{options:[{id:"group.house", name:"Дом", options:[{id:"house.land_area", name:"Площадь участка, соток", type:"number", options:[]}]}]},
        card:{version:2, addressDependentFacts:[], mainFields:["house.land_area"]}});
      if (url === "/api/workspace/categories/houses_long_term_rent/analyze") return response({schemaVersion:"1",
        suggestions:[{field:"house.land_area", value:"10", quote:"10 соток"}], questions:[]});
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch",fetcher);
    const fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    vi.spyOn(app,"checkExtension").mockResolvedValue();
    const root = fixture.nativeElement as HTMLElement;
    const textarea = () => root.querySelector<HTMLTextAreaElement>("textarea.source-description");
    const select = (index: number) => { root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index].click(); fixture.detectChanges(); };
    const enter = (value: string) => { const input = textarea()!; input.value = value; input.dispatchEvent(new Event("input")); fixture.detectChanges(); };
    fixture.detectChanges();
    try {
      await vi.waitFor(() => { fixture.detectChanges(); expect(textarea()).not.toBeNull(); });
      expect(Array.from(root.querySelectorAll('[role="tab"]'), t => t.textContent?.trim())).toEqual(["Аренда квартир", "Продажа квартир", "Аренда домов"]);
      expect(root.querySelector("button.publish")).not.toBeNull();
      enter("Первое объявление");
      select(1);
      await vi.waitFor(() => { fixture.detectChanges(); expect(textarea()).not.toBeNull(); });
      expect(textarea()!.value).toBe("");
      expect(root.querySelector("button.publish")).not.toBeNull();
      enter("Продам квартиру за 85 000 USD");
      const price = () => root.querySelector<HTMLInputElement>('[id="rental-sale.price"]');
      root.querySelector<HTMLButtonElement>("button.ai-button")!.click();
      await vi.waitFor(() => { fixture.detectChanges(); expect(price()?.value).toBe("85000"); });
      select(0); expect(textarea()!.value).toBe("Первое объявление");
      expect(price()).toBeNull();
      select(1); expect(textarea()!.value).toBe("Продам квартиру за 85 000 USD");
      expect(price()?.value).toBe("85000");
      select(2);
      await vi.waitFor(() => { fixture.detectChanges(); expect(textarea()).not.toBeNull(); });
      expect(textarea()!.value).toBe("");
      expect(root.textContent).toContain("Сдать дом");
      expect(root.textContent).toContain("Площадь участка, соток");
      expect(root.textContent).not.toContain("соток, м²");
      expect(root.querySelector("button.publish")).not.toBeNull();
      enter("Сдам дом, участок 10 соток");
      root.querySelector<HTMLButtonElement>("button.ai-button")!.click();
      const plot = () => root.querySelector<HTMLInputElement>('[id="rental-house.land_area"]');
      await vi.waitFor(() => { fixture.detectChanges(); expect(plot()?.value).toBe("10"); });
      select(1); expect(price()?.value).toBe("85000"); expect(plot()).toBeNull();
      select(0); expect(textarea()!.value).toBe("Первое объявление");
      select(2); expect(textarea()!.value).toBe("Сдам дом, участок 10 соток"); expect(plot()?.value).toBe("10");
      expect(root.querySelectorAll("textarea.source-description")).toHaveLength(1);
      for (const category of ["apartments_long_term_rent", "apartments_sale", "houses_long_term_rent"])
        expect(fetcher.mock.calls.filter(([url]) => url === "/api/workspace/categories/" + category + "/editor")).toHaveLength(1);
    } finally { fixture.destroy(); }
  });
  it("ends the session without storing the form",async()=>{
    app=new AppComponent();app.profile=profile;
    const steps:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>{
      steps.push(String(url));return response(url==="/api/workspace/session"?{profile:null,profiles:[profile]}:{ok:true});
    }));
    await app.logout();
    expect(steps).toEqual(["/api/workspace/logout","/api/workspace/session"]);
    expect(app.profile).toBeNull();expect(app.settings).toEqual({});
  });
  it("keeps login and registration available without exposing removed views",async()=>{
    app=new AppComponent();app.authMode="register";app.login="new";app.password="secret-password";
    vi.spyOn(app,"checkExtension").mockResolvedValue();
    const fetcher=vi.fn(async(url:unknown)=>response(url==="/api/workspace/register"?{profile}:{settings:{}}));
    vi.stubGlobal("fetch",fetcher);await app.authenticate();
    expect(app.profile).toEqual(profile);expect(app.password).toBe("");
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(["/api/workspace/register","/api/workspace/settings"]);
  });
  it("shows a retry screen when the session cannot be loaded",async()=>{
    app=new AppComponent();vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
    await app.session();expect(app.ready).toBe(true);expect(app.unavailable).toBe(true);
  });
});
