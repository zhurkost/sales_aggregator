import { EXTENSION_VERSION } from "../../../../lib/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalPublicationComponent } from "./rental-publication.component";
import { RentalFormStore } from "./rental-form.store";
import { RentalPublicationGateway } from "./rental-publication.gateway";
const extension = vi.fn(async () => ({
  capabilities: ["rental-publishing", "rental-address-suggestions", "rental-form-session"],
  jobs: [],
}));
const gateway = {
  request: extension,
  add: vi.fn(),
};
afterEach(() => vi.clearAllMocks());
describe("publication of incomplete rental cards", () => {
  it("asks to update older extensions without address suggestion support", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(() => "owner");
    c.workspaceId = "owner";
    c.sessionId = c.store.id;
    c.store.card.platforms = ["realt"];
    extension.mockResolvedValueOnce({capabilities:["rental-publishing"], jobs:[]});
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("photo changes update the current form without altering its attributes", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(
      () => "owner",
    );
    c.workspaceId = "owner";
    c.sessionId = c.store.id;
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
    expect(c.store.editVersion).toBe(1);
    expect(c.photos).toEqual(photos);
    expect(c.store.card.values).toEqual({});
    await c.remove(photos[0]);
    expect(c.photos).toEqual([]);
    c.ngOnDestroy();
    c.store.destroy();
  });
  it("offers publish without checking or resolving any issues, launches the exact filled snapshot", async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: RentalPublicationGateway, useValue: gateway }],
    });
    const fixture = TestBed.createComponent(RentalPublicationComponent),
      store = new RentalFormStore(
        () => "owner",
        );
    store.card.platforms = ["kufar", "onliner", "realt", "domovita"];
    store.card.values = { "listing.description": "Сдам квартиру" };
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
    fixture.componentRef.setInput("store", store);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.componentRef.setInput("sessionId", store.id);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.ready).toBe(true));
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      ".publish",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await fixture.componentInstance.publish();
    expect(extension).toHaveBeenCalledWith(
      "RENTAL_RUN",
      expect.objectContaining({
        id: store.id,
        revision: store.editVersion + 1,
        profileId: "owner",
        mode: "automatic",
        card: store.card,
      }),
      25000,
    );
    expect(store.card.values).toEqual({
      "listing.description": "Сдам квартиру",
    });
    fixture.destroy();
    store.destroy();
  });
  it("assist mode is explicitly passed and unsupported extension cannot launch", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(
      () => "owner",
    );
    c.store.card.platforms = ["realt"];
    c.workspaceId = "owner";
    c.sessionId = c.store.id;
    await c.publish();
    expect(extension).not.toHaveBeenCalled();
    expect(c.error).toContain(EXTENSION_VERSION);
    c.ready = true;
    c.mode = "assist";
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
