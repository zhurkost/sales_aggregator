import { Component, Input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppComponent } from "./app.component";
import { RentalEditorComponent } from "./rental/rental-editor.component";

@Component({selector:"app-rental-editor", standalone:true, template:"<p>Rental editor</p>"})
class RentalStub {
  @Input() workspaceId = "";
  @Input() profileDefaults = {};
}
const profile = {id:"owner",name:"Owner",login:"owner"};
const response = (body: unknown) => new Response(JSON.stringify(body),{status:200});
describe("Rental-only workspace",()=>{
  let app: AppComponent;
  afterEach(()=>{app?.ngOnDestroy();vi.unstubAllGlobals();vi.restoreAllMocks();});
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
    expect(nav.textContent.trim()).toBe("Аренда квартир");
    expect(fixture.nativeElement.querySelector('app-rental-editor')).not.toBeNull();
    for(const label of ["Новое объявление","Очередь и уведомления","Команда","Массовая загрузка","Справочник площадок","Интеграции"])
      expect(fixture.nativeElement.textContent).not.toContain(label);
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(["/api/workspace/session","/api/workspace/settings"]);
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
