import { EXTENSION_VERSION } from "../../../../lib/workspace";
import { HOUSE_SALE } from "../listing-categories";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { RentalPublicationComponent } from "./rental-publication.component";
import { RentalFormStore } from "./rental-form.store";
import { RentalPublicationGateway } from "./rental-publication.gateway";
const extension = vi.fn(async () => ({
  capabilities: ["rental-publishing", "rental-address-suggestions", "rental-form-session", "rental-field-transfer-v2", "rental-address-type-then-first", "rental-onliner-city-menu", "rental-localized-price"],
  jobs: [],
}));
const gateway = {
  request: extension,
  add: vi.fn(),
  importLinks: vi.fn(),
};
afterEach(() => vi.clearAllMocks());
describe("publication of incomplete rental cards", () => {
  it("requires house sale support, then launches with the house sale category", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(() => "owner", () => ({}), () => HOUSE_SALE);
    c.workspaceId = "owner"; c.sessionId = c.store.id;
    c.store.card.platforms = ["realt"];
    const capabilities = ["rental-publishing", "rental-address-suggestions", "rental-form-session", "rental-field-transfer-v2", "rental-address-type-then-first", "rental-onliner-city-menu", "rental-localized-price", "listing-category-path", "sale-scoped-controls"];
    extension.mockResolvedValueOnce({capabilities, jobs:[]});
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    extension.mockResolvedValueOnce({capabilities, jobs:[]});
    await c.publish();
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    extension.mockResolvedValueOnce({capabilities:[...capabilities, "house-sale-publishing"], jobs:[]});
    await c.checkConnection();
    expect(c.ready).toBe(true);
    await c.publish();
    expect(extension).toHaveBeenCalledWith("RENTAL_RUN", expect.objectContaining({categoryId:HOUSE_SALE}), 25000);
    c.ngOnDestroy(); c.store.destroy();
  });
  it("counts local files without duplicating imported URLs or sending image bytes to preparation", async () => {
    const store = new RentalFormStore(() => "owner");
    const url = "https://example.com/one.jpg";
    store.card.values["media.images"] = [url];
    store.setLocalFiles("media.images", [{}, {sourceUrl:url}]);
    expect(store.preparationInput().localFileCounts).toEqual({"media.images":1});
    expect(store.card).not.toHaveProperty("localFileCounts");
    store.card.values["media.images"] = [];
    expect(store.preparationInput().localFileCounts).toEqual({"media.images":2});
    store.setLocalFiles("media.images", []);
    expect(store.preparationInput().localFileCounts).toEqual({});
    store.destroy();
  });
  it("imports linked images once, then publishes files and removes matching links with a preview", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(() => "owner");
    c.workspaceId = "owner"; c.sessionId = c.store.id;
    c.store.card.platforms = ["realt"];
    const sourceUrl = "https://example.com/photo.jpg";
    c.store.card.values["media.images"] = [sourceUrl];
    const photo = {id:"linked-photo",name:"photo.jpg",type:"image/jpeg",dataUrl:"data:image/jpeg;base64,AAAA",sourceUrl};
    gateway.importLinks.mockResolvedValueOnce([photo]);
    await c.ngOnChanges();
    await c.importLinks();
    expect(c.pendingPhotoLinks()).toEqual([]);
    expect(c.photos).toEqual([photo]);
    await c.publish();
    expect(extension).toHaveBeenCalledWith("RENTAL_RUN", expect.objectContaining({photos:[photo]}), 25000);
    await c.remove(photo);
    expect(c.photos).toEqual([]);
    expect(c.store.card.values["media.images"]).toEqual([]);
    c.ngOnDestroy(); c.store.destroy();
  });
  it("does not silently publish photo links without importing their files", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(() => "owner");
    c.workspaceId = "owner";
    c.sessionId = c.store.id;
    c.store.card.platforms = ["realt"];
    c.store.card.values["media.images"] = ["https://example.com/photo.jpg"];
    await c.ngOnChanges();
    await c.publish();
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    expect(c.error).toMatch(/фото|ссыл/i);
    c.ngOnDestroy(); c.store.destroy();
  });
  it("asks to update older extensions without address suggestion support", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalFormStore(() => "owner");
    c.workspaceId = "owner";
    c.sessionId = c.store.id;
    c.store.card.platforms = ["realt"];
    extension.mockResolvedValueOnce({capabilities:["rental-publishing"], jobs:[]});
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    extension.mockResolvedValueOnce({capabilities:["rental-publishing"], jobs:[]});
    await c.publish();
    expect(c.connectionMessage).toContain(EXTENSION_VERSION);
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
    expect(fixture.nativeElement.textContent).not.toContain("Автоматически пройти шаги формы");
    expect(button.disabled).toBe(false);
    await fixture.componentInstance.publish();
    expect(extension).toHaveBeenCalledWith(
      "RENTAL_RUN",
      expect.objectContaining({
        id: store.id,
        revision: store.editVersion + 1,
        profileId: "owner",
        mode: "automatic",
        card: {...store.card, localFileCounts:{}},
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
    extension.mockRejectedValueOnce(new Error("Нет связи с расширением"));
    await c.publish();
    expect(c.connectionMessage).toContain("Нет связи");
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.mode = "assist";
    await c.publish();
    expect(c.connectionMessage).toBe("");
    expect(extension).toHaveBeenCalledWith(
      "RENTAL_RUN",
      expect.objectContaining({ mode: "assist" }),
      25000,
    );
    c.ngOnDestroy();
    c.store.destroy();
  });
});
