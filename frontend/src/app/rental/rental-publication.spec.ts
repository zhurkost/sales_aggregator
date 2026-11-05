import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalPublicationComponent } from "./rental-publication.component";
import { RentalDraftStore } from "./rental-draft.store";
import { RentalPublicationGateway } from "./rental-publication.gateway";
const extension = vi.fn(async () => ({
  capabilities: ["rental-publishing", "rental-address-suggestions"],
  jobs: [],
}));
const gateway = {
  request: extension,
  photos: vi.fn(async () => []),
  add: vi.fn(),
};
afterEach(() => vi.clearAllMocks());
describe("publication of incomplete rental cards", () => {
  it("asks to update older extensions without address suggestion support", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["realt"];
    extension.mockResolvedValueOnce({capabilities:["rental-publishing"], jobs:[]});
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain("0.9.7");
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("photo changes revise a saved card without altering its attributes", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(
      () => "owner",
      () => {},
    );
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    const photos = [
      {
        id: "photo-1",
        name: "one.jpg",
        type: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,AAAA",
      },
    ];
    gateway.add.mockResolvedValueOnce(photos);
    await c.add([]);
    expect(c.store.dirty).toBe(true);
    expect(c.store.draft.localPhotoIds).toEqual(["photo-1"]);
    expect(c.store.draft.values).toEqual({});
    await c.remove(photos[0]);
    expect(c.store.draft.localPhotoIds).toEqual([]);
    c.ngOnDestroy();
    c.store.destroy();
  });
  it("offers publish without checking or resolving any issues, saves and launches the exact filled snapshot", async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: RentalPublicationGateway, useValue: gateway }],
    });
    const fixture = TestBed.createComponent(RentalPublicationComponent),
      store = new RentalDraftStore(
        () => "owner",
        () => {},
      );
    store.draft.platforms = ["kufar", "onliner", "realt", "domovita"];
    store.draft.values = { "listing.description": "Сдам квартиру" };
    store.check.checked = true;
    store.check.stale = true;
    store.results = [
      {
        platform: "kufar",
        values: {},
        dataReady: false,
        publicationReady: false,
        issues: [
          { code: "required", field: "phone", message: "Добавьте телефон" },
        ],
      },
    ];
    const save = vi.spyOn(store, "flush").mockResolvedValue();
    fixture.componentRef.setInput("store", store);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.componentRef.setInput("draftId", store.id);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.ready).toBe(true));
    expect(store.dirty).toBe(false);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      ".publish",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fixture.componentInstance.publish();
    expect(save).toHaveBeenCalledOnce();
    expect(extension).toHaveBeenCalledWith(
      "RENTAL_RUN",
      expect.objectContaining({
        id: store.id,
        profileId: "owner",
        mode: "automatic",
        draft: store.draft,
      }),
      25000,
    );
    expect(store.draft.values).toEqual({
      "listing.description": "Сдам квартиру",
    });
    fixture.destroy();
    store.destroy();
  });
  it("assist mode is explicitly passed and unsupported extension cannot launch", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(
      () => "owner",
      () => {},
    );
    c.store.draft.platforms = ["realt"];
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    await c.publish();
    expect(extension).not.toHaveBeenCalled();
    expect(c.error).toContain("0.9.7");
    c.ready = true;
    c.mode = "assist";
    vi.spyOn(c.store, "flush").mockResolvedValue();
    await c.publish();
    expect(extension).toHaveBeenCalledWith(
      "RENTAL_RUN",
      expect.objectContaining({ mode: "assist" }),
      25000,
    );
    c.ngOnDestroy();
    c.store.destroy();
  });
});
