import { describe, it, expect, vi, afterEach } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalEditorComponent } from "./rental-editor.component";
import { EditorSchema, Field, RentalAiResult } from "./rental-api";

const field = (id:string,type="text"):Field => ({id,name:id,description:"",type,options:[],fill_rule:{}});
const schema:EditorSchema = {version:"2",category:{options:[
  { ...field("group.main","group"),options:[field("price"),field("rooms","enum")] },
  { ...field("group.amenities","group"),name:"Удобства", options:[field("wifi","boolean"),field("washing","boolean")] },
]},canonicalValues:{rooms:["1","2"]},platforms:{one:{name:"Площадка",extras:[],labels:{},choiceLabels:{},constants:{},bindings:[]}},addressSuggestions:false};
const result:RentalAiResult = {schemaVersion:"2",model:"test",questions:[],address:null,ignored:0,suggestions:[
  {field:"price",value:"1500",quote:"1500 BYN"},{field:"wifi",value:false,quote:"без Wi-Fi"},{field:"washing",value:true,quote:"стиральная машина"},
]};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
function setup(data:RentalAiResult=result) {
  const c = new RentalEditorComponent(); c.schema=structuredClone(schema); c.draft.schemaVersion="2"; c.draft.platforms=["one"];
  c.draft.values["listing.description"]="Сдам квартиру, 1500 BYN, без Wi-Fi, есть стиральная машина.";
  const fetch=vi.fn(async (url:string)=>response(url.endsWith("/analyze")?data:url.endsWith("/drafts")?{drafts:[]}:{revision:1}));
  vi.stubGlobal("fetch",fetch); return {c,fetch};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("compact rental editor with AI",()=>{
  it("warns before leaving a dirty draft after splitting editor state",()=>{
    const c=new RentalEditorComponent();
    const event={preventDefault:vi.fn(),returnValue:"unchanged"} as unknown as BeforeUnloadEvent;
    c.unload(event);expect(event.preventDefault).not.toHaveBeenCalled();
    c.dirty=true;c.unload(event);expect(event.preventDefault).toHaveBeenCalledOnce();expect(event.returnValue).toBe("");
    c.ngOnDestroy();
  });
  it("traps reverse Tab from the dialog title without hijacking Tab inside a field group",()=>{
    const panel=document.createElement("section");panel.className="rental-drawer";
    panel.innerHTML='<h2 tabindex="-1">Title</h2><button>Close</button><div tabindex="-1"><input /></div><button>Done</button>';
    document.body.append(panel);const c=new RentalEditorComponent();
    try {
      panel.querySelector("h2")!.focus();
      const back=new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,cancelable:true});c.panelKeys(back);
      expect(back.defaultPrevented).toBe(true);expect(document.activeElement?.textContent).toBe("Done");
      panel.querySelector("div")!.focus();
      const forward=new KeyboardEvent("keydown",{key:"Tab",cancelable:true});c.panelKeys(forward);
      expect(forward.defaultPrevented).toBe(false);
    } finally { panel.remove();c.ngOnDestroy(); }
  });
  it("fills empty fields including false but asks before replacing manual data",async()=>{
    const {c,fetch}=setup();c.draft.values.price="1600";
    await c.fillFromDescription();
    expect(c.draft.values).toMatchObject({price:"1600",wifi:false,washing:true});
    expect(c.aiConflicts).toEqual([result.suggestions[0]]);
    expect(c.draft.aiEvidence?.wifi).toBe("без Wi-Fi");
    expect(fetch.mock.calls.filter(([url])=>url.endsWith("/analyze"))).toHaveLength(1);
    c.acceptAiField(0);expect(c.draft.values.price).toBe("1500");expect(c.aiConflicts).toEqual([]);
    c.setTyped(field("price"),"1800");expect(c.draft.aiEvidence?.price).toBeUndefined();c.ngOnDestroy();
  });
  it("preserves a confirmed address and clears stale dependencies only when replacement is accepted",async()=>{
    const address={provider:"dadata",countryIso:"BY",label:"Новый адрес",settlement:"Минск",street:"Новая",house:"2",confirmed:true};
    const {c}=setup({...result,address});
    c.schema!.card={version:2,addressDependentFacts:["metro"]};
    c.draft.address={...address,label:"Старый адрес",street:"Старая",house:"1",latitude:"53.9"}; c.draft.values.metro="old";
    await c.fillFromDescription();expect(c.draft.address.label).toBe("Старый адрес");expect(c.aiAddress?.label).toBe("Новый адрес");expect(c.draft.values.metro).toBe("old");
    c.acceptAiAddress();expect(c.draft.address.label).toBe("Новый адрес");expect(c.draft.values.metro).toBeUndefined();
    expect(c.resetFacts?.values).toEqual({metro:"old"});c.ngOnDestroy();
  });
  it("accepting an unconfirmed AI address follows the typing rule and keeps nearby facts",async()=>{
    const address={provider:"manual",countryIso:"BY",label:"Новый адрес",settlement:"",street:"",house:"",confirmed:false};
    const {c}=setup({...result,address});
    c.schema!.card={version:2,addressDependentFacts:["metro"]};
    c.draft.address={...address,label:"Старый адрес",confirmed:true,latitude:"53.9"}; c.draft.values.metro="old";
    await c.fillFromDescription();c.acceptAiAddress();
    expect(c.draft.address.label).toBe("Новый адрес");expect(c.draft.address.confirmed).toBe(false);
    expect(c.draft.values.metro).toBe("old");expect(c.resetFacts).toBeNull();c.ngOnDestroy();
  });
  it("does not apply a late AI response to a destroyed or changed card",async()=>{
    const {c}=setup();let done!:(r:Response)=>void;
    vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>done=r)));
    const pending=c.fillFromDescription();await vi.waitFor(()=>expect(done).toBeDefined());
    c.ngOnDestroy();done(response(result));await pending;
    expect(c.draft.values.price).toBeUndefined();expect(c.aiBusy).toBe(false);
  });
  it("upgrades an old literal AI address using the server-normalized result", async () => {
    const sourceLabel = "город Минск, ул. Брикета, дом 18";
    const address = {provider:"dadata",countryIso:"BY",label:"г Минск, ул Брикета, д 18",settlement:"г Минск",street:"ул Брикета",house:"18",confirmed:true,resolution:"matched" as const};
    const {c} = setup({...result,address,addressResolution:{status:"matched",sourceLabel,message:"Адрес проверен по DaData."}});
    c.draft.address = {provider:"manual",countryIso:"BY",label:sourceLabel,settlement:"",street:"",house:"",confirmed:false};
    await c.fillFromDescription();
    expect(c.draft.address).toEqual(address);expect(c.aiAddress).toBeNull();
    expect(c.aiMessage).toContain("DaData");c.ngOnDestroy();
  });
  it("preserves manually filled address parts even when the source label is identical", async () => {
    const address = {provider:"manual",countryIso:"BY",label:"Минск, Брикета, 18",settlement:"Минск",street:"Брикета",house:"18",confirmed:false};
    const {c} = setup({...result,address:{...address,provider:"dadata",confirmed:true},addressResolution:{status:"matched",sourceLabel:address.label,message:"DaData"}});
    c.draft.address = {...address,house:"18А"};
    await c.fillFromDescription();
    expect(c.draft.address.house).toBe("18А");expect(c.aiAddress?.house).toBe("18");c.ngOnDestroy();
  });
  it("keeps successful AI facts when address lookup falls back to manual entry", async () => {
    const address = {provider:"manual",countryIso:"BY",label:"Минск, Брикета, 18",settlement:"Минск",street:"Брикета",house:"18",confirmed:false,resolution:"unavailable" as const};
    const {c} = setup({...result,address,addressResolution:{status:"unavailable",sourceLabel:address.label,message:"DaData недоступна. Проверьте адрес в отдельных полях."}});
    await c.fillFromDescription();
    expect(c.draft.address).toEqual(address);expect(c.draft.values.price).toBe("1500");
    expect(c.aiMessage).toContain("отдельных полях");expect(c.error).toBe("");c.ngOnDestroy();
  });
  it("keeps address-dependent suggestions together and discards them after a manual address change",async()=>{
    const address={provider:"manual",countryIso:"BY",label:"Адрес B",settlement:"",street:"",house:"",confirmed:false};
    const {c}=setup({...result,address,suggestions:[{field:"metro",value:"Метро B",quote:"Метро B"}]});
    c.schema!.card={version:2,addressDependentFacts:["metro"]};
    c.schema!.category.options[1].options.push(field("metro"));
    c.draft.address={...address,label:"Адрес A"};
    await c.fillFromDescription();expect(c.draft.values.metro).toBeUndefined();
    c.acceptAiAddress();expect(c.draft.address.label).toBe("Адрес B");expect(c.draft.values.metro).toBe("Метро B");
    c.addressChanged({...address,label:"Адрес A"});expect(c.draft.values.metro).toBe("Метро B");
    c.setTyped(field("metro"),"Своё метро");
    await c.fillFromDescription();expect(c.aiAddressFacts).toHaveLength(1);
    c.addressChanged({...address,label:"Адрес C"});c.acceptAiAddress();c.acceptAiField(0);
    expect(c.draft.address.label).toBe("Адрес C");expect(c.draft.values.metro).toBe("Своё метро");expect(c.aiAddress).toBeNull();c.ngOnDestroy();
  });
  it("keeps description and manual data after a provider error",async()=>{
    const {c}=setup();c.draft.values.price="1600";
    vi.stubGlobal("fetch",vi.fn(async()=>response({error:"ИИ недоступен"},502)));
    await c.fillFromDescription();expect(c.error).toBe("ИИ недоступен");expect(c.description).toContain("1500 BYN");expect(c.draft.values.price).toBe("1600");expect(c.busy).toBe(false);c.ngOnDestroy();
  });
  it("has no accordions, hides rare inputs, and lets users find and edit them once",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>response(url.endsWith("/editor")?schema:{drafts:[]})));
    const fixture=TestBed.createComponent(RentalEditorComponent);fixture.componentRef.setInput("workspaceId","test");fixture.detectChanges();
    await vi.waitFor(()=>{fixture.detectChanges();expect(fixture.componentInstance.schema).not.toBeNull();});
    const c=fixture.componentInstance, el=fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll("details, .fine-print, .field-platforms")).toHaveLength(0);
    expect(el.querySelector('[id="rental-wifi"]')).toBeNull();
    c.openPanel("parameters");c.parameterSearch="wifi";fixture.detectChanges();
    expect(el.querySelectorAll('[id="rental-wifi"]')).toHaveLength(1);
    expect(el.querySelector('[id="rental-washing"]')).toBeNull();
    c.setTyped(field("wifi","boolean"),false);c.closePanel();c.openPanel("parameters");fixture.detectChanges();
    expect(c.draft.values.wifi).toBe(false);expect(el.querySelector('[role="dialog"]')).not.toBeNull();fixture.destroy();
  });
});
