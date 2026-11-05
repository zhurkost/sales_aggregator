import { afterEach, describe, expect, it, vi } from "vitest";
import { RentalApplicability } from "./rental-applicability";
import { RentalDraftStore } from "./rental-draft.store";
import { RentalViewModel } from "./rental-view.model";
import type { RentalDraft } from "./rental-models";

const response = (body: unknown) => new Response(JSON.stringify(body));
function setup() {
  const draft: RentalDraft = {schemaVersion:"v1",values:{area:"1,123456789012345678"},extras:{},platforms:["example"],address:null};
  const context = {workspace:"owner",id:"card",version:1,schemaVersion:"v1",enabled:true,destroyed:false,draft};
  const state = new RentalApplicability(() => ({...context}));
  return {state,context};
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("server-owned applicability", () => {
  it("debounces raw input and consumes only the server decision", async () => {
    vi.useFakeTimers();
    const {state,context} = setup();
    const fetcher = vi.fn(async () => response({schemaVersion:"v1",platforms:{example:{area:false}}}));
    vi.stubGlobal("fetch",fetcher);
    state.schedule(); await vi.advanceTimersByTimeAsync(300);
    context.version++; state.schedule(); await vi.advanceTimersByTimeAsync(300);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,init] = fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("/api/workspace/rental/applicability");
    expect(JSON.parse(String(init.body)).values.area).toBe("1,123456789012345678");
    expect(state.field("example","area")).toBe(false);
    expect(context.draft.values.area).toBe("1,123456789012345678");
    state.clear();
  });
  it.each(["version","id","workspace","schemaVersion","destroyed"] as const)("rejects late responses after changing %s", async key => {
    const {state,context} = setup();
    let finish!: (r:Response) => void;
    vi.stubGlobal("fetch",vi.fn(() => new Promise<Response>(resolve => finish=resolve)));
    const pending=state.refresh();
    if(key==="version") context.version++;
    else if(key==="destroyed") context.destroyed=true;
    else context[key]="other";
    finish(response({schemaVersion:"v1",platforms:{example:{area:false}}}));
    await pending;
    expect(state.field("example","area")).toBeNull();
    state.clear();
  });
  it("falls back to showing fields on failure without accepting an old decision", async () => {
    const {state} = setup();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response({schemaVersion:"v1",platforms:{example:{area:false}}}))
      .mockRejectedValueOnce(new Error("offline")));
    await state.refresh(); expect(state.field("example","area")).toBe(false);
    await state.refresh(); expect(state.field("example","area")).toBeNull();
    expect(state.error).toContain("Не удалось");
    state.clear();
  });
  it("applies server decisions only to display and leaves typed facts intact", async () => {
    const store=new RentalDraftStore(()=>"owner",()=>{}), view=new RentalViewModel(store);
    store.schema={version:"v1",serverApplicability:true,addressSuggestions:false,canonicalValues:{},category:{options:[]},platforms:{example:{labels:{},choiceLabels:{}}}};
    store.draft.schemaVersion="v1"; store.draft.platforms=["example"]; store.draft.values.area="42,5";
    const field={id:"area",name:"Area",type:"text",description:"",options:[],uses:[{platform:"example",target:"native-area"}]};
    const group={id:"group",name:"Group",type:"group",description:"",options:[field]};
    vi.stubGlobal("fetch",vi.fn(async()=>response({schemaVersion:"v1",platforms:{example:{"native-area":false}}})));
    expect(view.groupFields(group)).toHaveLength(1);
    await store.applicability.refresh(); expect(view.groupFields(group)).toHaveLength(0);
    expect(store.draft.values.area).toBe("42,5"); expect(store.dirty).toBe(false);
    store.destroy();
  });
  it("displays the actual prepared description instead of replacing it with a newer draft", () => {
    const store=new RentalDraftStore(()=>"owner",()=>{}), view=new RentalViewModel(store);
    store.draft.values["listing.description"]="New unsaved description";
    expect(view.preparedValues({platform:"example",values:{"listing.description":"Prepared description"},issues:[],dataReady:true,publicationReady:false})[0].value).toBe("Prepared description");
    store.destroy();
  });
});
