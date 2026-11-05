import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import {
  REQUIRED_EXTENSION_VERSION,
  RentalPublicationComponent,
} from "./rental-publication.component";
import { RentalDraftStore } from "./rental-draft.store";
import { RentalPublicationGateway } from "./rental-publication.gateway";
import type { Photo } from "../../../../lib/workspace";
const extension = vi.fn(async () => ({
  capabilities: [
    "rental-publishing",
    "rental-address-suggestions",
    "rental-checks-passed",
    "rental-integration-version",
    "rental-iframe-richtext",
    "rental-server-photos",
    "rental-publication-history",
  ],
  jobs: [],
}));
const gateway = {
  request: extension,
  compress: vi.fn(async (files: File[]) =>
    files.map((f) => ({ name: f.name, dataUrl: "data:image/jpeg;base64,/9j/" })),
  ),
  localPhotos: vi.fn(async (): Promise<Photo[]> => []),
  forgetLocalPhotos: vi.fn(async () => undefined),
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
/** Server answers for the card's photos; the requests are recorded. */
function photoServer() {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let revision = 0;
  let photos: { id: string; name: string; type: string; size: number }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("/api/workspace/rental/", "").replace(/^drafts\/[^/]+/, "card");
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requests.push({ path, body });
      if (path === "card") revision = body.revision + 1;
      else {
        revision = body.revision + 1;
        if (path === "card/photos")
          photos = [
            ...photos,
            ...body.photos.map((p: { name: string }, i: number) => ({
              id: "p" + (photos.length + i),
              name: p.name,
              type: "image/jpeg",
              size: 3,
            })),
          ];
        if (path === "card/photos/delete") photos = photos.filter((p) => p.id !== body.photo);
        if (path === "card/photos/order")
          photos = body.order.map((id: string) => photos.find((p) => p.id === id));
      }
      return new Response(
        JSON.stringify(path === "card" ? { revision } : { revision, photos }),
      );
    }),
  );
  return requests;
}
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
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("does not launch with a 0.9.2 extension that would auto-submit without the server check", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["kufar"];
    extension.mockResolvedValueOnce({capabilities:["rental-publishing", "rental-address-suggestions"], jobs:[]});
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("does not launch with a 0.9.3 extension that would submit a form filled under replaced rules", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["kufar"];
    extension.mockResolvedValueOnce({
      capabilities: ["rental-publishing", "rental-address-suggestions", "rental-checked-submit"],
      jobs: [],
    });
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("does not launch with a 0.9.4 extension that rejects the Realt description editor", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["realt"];
    extension.mockResolvedValueOnce({
      capabilities: [
        "rental-publishing",
        "rental-address-suggestions",
        "rental-checked-submit",
        "rental-integration-version",
      ],
      jobs: [],
    });
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("does not launch with an extension that still waits for dataReady before the final click", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["kufar"];
    extension.mockResolvedValueOnce({
      capabilities: [
        "rental-publishing",
        "rental-address-suggestions",
        "rental-checked-submit",
        "rental-integration-version",
        "rental-iframe-richtext",
      ],
      jobs: [],
    });
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("offers the download of the required extension version when it is missing", async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: RentalPublicationGateway, useValue: gateway }],
    });
    const fixture = TestBed.createComponent(RentalPublicationComponent),
      store = new RentalDraftStore(
        () => "owner",
        () => {},
      );
    extension.mockRejectedValueOnce(new Error("no extension"));
    fixture.componentRef.setInput("store", store);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.componentRef.setInput("draftId", store.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector(
      'a[href="/autopost-extension.zip"]',
    ) as HTMLAnchorElement;
    expect(fixture.componentInstance.ready).toBe(false);
    expect(link.textContent?.trim()).toBe(
      "Скачать расширение " + REQUIRED_EXTENSION_VERSION,
    );
    fixture.destroy();
    store.destroy();
  });
  it("does not launch with a 0.9.5 extension that uploads the photos the page sends", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["kufar"];
    extension.mockResolvedValueOnce({
      capabilities: [
        "rental-publishing",
        "rental-address-suggestions",
        "rental-checks-passed",
        "rental-integration-version",
        "rental-iframe-richtext",
      ],
      jobs: [],
    });
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("does not launch with an extension that keeps publications only in the browser", async () => {
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.platforms = ["kufar"];
    extension.mockResolvedValueOnce({
      capabilities: [
        "rental-publishing",
        "rental-address-suggestions",
        "rental-checks-passed",
        "rental-integration-version",
        "rental-iframe-richtext",
        "rental-server-photos",
      ],
      jobs: [],
    });
    await c.ngOnChanges();
    expect(c.ready).toBe(false);
    await c.publish();
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
    expect(extension).not.toHaveBeenCalledWith("RENTAL_RUN", expect.anything(), expect.anything());
    c.ngOnDestroy(); c.store.destroy();
  });
  it("stores photos with the card on the server: each change is a revision, the card is untouched", async () => {
    const requests = photoServer();
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.store.schema = { photoLimit: 12 } as never;
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    c.store.draft.values = { "listing.title": "Квартира" };
    // A new card is saved first: the photos belong to a card the server has.
    await c.add([new File(["a"], "room.jpg"), new File(["b"], "kitchen.jpg")]);
    expect(requests.map((r) => r.path)).toEqual(["card", "card/photos"]);
    expect(requests[1].body).toEqual({
      revision: 1,
      photos: [
        { name: "room.jpg", dataUrl: "data:image/jpeg;base64,/9j/" },
        { name: "kitchen.jpg", dataUrl: "data:image/jpeg;base64,/9j/" },
      ],
    });
    expect(c.photos.map((p) => p.name)).toEqual(["room.jpg", "kitchen.jpg"]);
    expect(c.store.revision).toBe(2);
    expect(c.store.dirty).toBe(false);
    expect(c.photoUrl(c.photos[0])).toBe(
      `/api/workspace/rental/drafts/${c.store.id}/photos/p0`,
    );
    await c.move(c.photos[1], -1);
    expect(requests.at(-1)).toEqual({
      path: "card/photos/order",
      body: { revision: 2, order: ["p1", "p0"] },
    });
    await c.remove(c.photos[0]);
    expect(requests.at(-1)).toEqual({
      path: "card/photos/delete",
      body: { revision: 3, photo: "p1" },
    });
    expect(c.photos.map((p) => p.name)).toEqual(["room.jpg"]);
    // The next save goes on top of the revision the photo change produced.
    c.store.changed();
    await c.store.save();
    expect(requests.at(-1)?.body["revision"]).toBe(4);
    expect(requests.at(-1)?.body["draft"]).toEqual(
      expect.objectContaining({ values: { "listing.title": "Квартира" } }),
    );
    expect("localPhotoIds" in (requests.at(-1)?.body["draft"] as object)).toBe(false);
    c.ngOnDestroy();
    c.store.destroy();
  });
  it("offers once to upload the photos an older release kept in this browser", async () => {
    const requests = photoServer();
    const local = [
      { id: "l1", name: "old.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/AA" },
      { id: "l2", name: "older.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/AB" },
    ];
    gateway.localPhotos.mockResolvedValue(local);
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.store.revision = 3;
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    await c.ngOnChanges();
    await vi.waitFor(() => expect(c.localPhotos).toEqual(local));
    expect(gateway.localPhotos).toHaveBeenCalledWith("owner", c.store.id);
    await c.uploadLocalPhotos();
    expect(requests).toEqual([
      {
        path: "card/photos",
        body: {
          revision: 3,
          photos: [
            { name: "old.jpg", dataUrl: "data:image/jpeg;base64,/9j/AA" },
            { name: "older.jpg", dataUrl: "data:image/jpeg;base64,/9j/AB" },
          ],
        },
      },
    ]);
    expect(c.photos.map((p) => p.name)).toEqual(["old.jpg", "older.jpg"]);
    expect(gateway.forgetLocalPhotos).toHaveBeenCalledWith("owner", c.store.id);
    expect(c.localPhotos).toEqual([]);
    // With photos on the server the browser copy is not offered again.
    gateway.localPhotos.mockClear();
    await c.ngOnChanges();
    expect(gateway.localPhotos).not.toHaveBeenCalled();
    expect(c.localPhotos).toEqual([]);
    gateway.localPhotos.mockResolvedValue([]);
    c.ngOnDestroy();
    c.store.destroy();
  });
  it("can drop the browser copy instead of uploading it", async () => {
    const requests = photoServer();
    gateway.localPhotos.mockResolvedValue([
      { id: "l1", name: "old.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/AA" },
    ]);
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.workspaceId = "owner";
    c.draftId = c.store.id;
    await c.ngOnChanges();
    await vi.waitFor(() => expect(c.localPhotos.length).toBe(1));
    await c.forgetLocalPhotos();
    expect(gateway.forgetLocalPhotos).toHaveBeenCalledWith("owner", c.store.id);
    expect(c.localPhotos).toEqual([]);
    expect(requests).toEqual([]);
    gateway.localPhotos.mockResolvedValue([]);
    c.ngOnDestroy();
    c.store.destroy();
  });
  it("checks the card again after a photo change, as photos are part of the check", async () => {
    const requests = photoServer();
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.store.revision = 1;
    c.store.check.checked = true;
    const refresh = vi.spyOn(c.store.check, "refresh").mockResolvedValue();
    await c.add([new File(["a"], "room.jpg")]);
    expect(requests.map((r) => r.path)).toEqual(["card/photos"]);
    expect(c.store.check.stale).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    c.ngOnDestroy();
    c.store.destroy();
  });
  it("shows the server's photo limit and does not compress a batch beyond it", async () => {
    const requests = photoServer();
    const c = new RentalPublicationComponent(gateway);
    c.store = new RentalDraftStore(() => "owner", () => {});
    c.store.schema = { photoLimit: 2 } as never;
    c.store.revision = 1;
    await c.add([new File(["a"], "1.jpg"), new File(["b"], "2.jpg"), new File(["c"], "3.jpg")]);
    expect(c.error).toBe("У квартиры может быть до 2 фотографий.");
    expect(gateway.compress).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
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
        checksPassed: false,
        form: [],
        manual: [],
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
        mode: "assist",
        draft: store.draft,
      }),
      25000,
    );
    // The extension takes the photos stored with the card from the server.
    const run = extension.mock.calls.find((call) => (call as unknown[])[0] === "RENTAL_RUN") as unknown[];
    expect("photos" in (run[1] as object)).toBe(false);
    expect(store.draft.values).toEqual({
      "listing.description": "Сдам квартиру",
    });
    fixture.destroy();
    store.destroy();
  });
  it("starts in assist mode and enables final submission only after confirmation", async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: RentalPublicationGateway, useValue: gateway }],
    });
    const fixture = TestBed.createComponent(RentalPublicationComponent),
      store = new RentalDraftStore(
        () => "owner",
        () => {},
      );
    store.draft.platforms = ["kufar"];
    extension.mockRejectedValueOnce(new Error("no extension"));
    fixture.componentRef.setInput("store", store);
    fixture.componentRef.setInput("workspaceId", "owner");
    fixture.componentRef.setInput("draftId", store.id);
    const c = fixture.componentInstance,
      el = fixture.nativeElement as HTMLElement,
      box = () => el.querySelector("input.automatic") as HTMLInputElement,
      render = async () => {
        fixture.detectChanges();
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
      },
      click = async (selector: string) => {
        (el.querySelector(selector) as HTMLElement).click();
        await render();
      };
    await render();
    expect(c.mode).toBe("assist");
    expect(box().checked).toBe(false);
    await click("input.automatic");
    expect(el.querySelector(".confirm")?.textContent).toContain(
      "Расширение само нажмёт «Подать» на площадках, где проверка прошла без замечаний. Платные услуги и CAPTCHA остаются за вами.",
    );
    expect(c.mode).toBe("assist");
    await click(".cancel-automatic");
    expect(c.mode).toBe("assist");
    expect(box().checked).toBe(false);
    expect(el.querySelector(".confirm")).toBeNull();
    await click("input.automatic");
    await click(".confirm-automatic");
    expect(c.mode).toBe("automatic");
    expect(box().checked).toBe(true);
    expect(el.querySelector(".confirm")).toBeNull();
    await click("input.automatic");
    expect(c.mode).toBe("assist");
    expect(box().checked).toBe(false);
    expect(el.querySelector(".confirm")).toBeNull();
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
    expect(c.error).toContain(REQUIRED_EXTENSION_VERSION);
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
