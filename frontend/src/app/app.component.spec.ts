import { describe, it, expect, vi, afterEach } from "vitest";
import { AppComponent } from "./app.component";
import { newRecord } from "../../../lib/workspace";
import { emptyListing } from "../../../lib/listing";

describe("Angular workspace migration", () => {
  let app: AppComponent;
  afterEach(() => {
    app?.ngOnDestroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const setup = () => {
    app = new AppComponent();
    app.profile = { id: "owner", name: "Owner", login: "owner" };
    return app;
  };
  it("does not discard edits typed while an autosave response is in flight", async () => {
    setup();
    app.ad = newRecord({ ...emptyListing, title: "First" });
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
    );
    const snapshot = app.ad,
      save = app.persist(snapshot);
    await Promise.resolve();
    app.change({
      ...snapshot,
      listing: { ...snapshot.listing, title: "Newer edit" },
    });
    finish(
      new Response(
        JSON.stringify({
          ad: {
            ...snapshot,
            revision: 1,
            contentVersion: 1,
            events: [],
            updatedAt: "2026-10-31T00:00:00Z",
          },
        }),
        { status: 200 },
      ),
    );
    await save;
    expect(app.ad.listing.title).toBe("Newer edit");
    expect(app.ad.revision).toBe(1);
    expect(app.dirty).toBe(true);
  });
  it("serializes writes and uses the revision returned by the previous save", async () => {
    setup();
    const record = app.ad;
    const revisions: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const input = JSON.parse(init.body as string);
        revisions.push(input.revision);
        return new Response(
          JSON.stringify({
            ad: { ...input, revision: input.revision + 1, events: [] },
          }),
          { status: 200 },
        );
      }),
    );
    await Promise.all([
      app.persist(record),
      app.persist({ ...record, text: "Second write" }),
    ]);
    expect(revisions).toEqual([0, 1]);
  });
  it("keeps a conflicting local draft available to the user", async () => {
    setup();
    app.change({ ...app.ad, text: "Do not lose this" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Карточка изменена" }), {
            status: 409,
          }),
      ),
    );
    await expect(app.persist()).rejects.toThrow("Карточка изменена");
    expect(app.ad.text).toBe("Do not lose this");
    expect(app.dirty).toBe(true);
  });
  it("uses the existing automatic-mode extension protocol", () => {
    setup();
    app.publishMode = "automatic";
    expect((app as any).launchPayload(app.ad).publishMode).toBe("automatic");
  });
  it("does not launch a sold record or skip user confirmation", async () => {
    setup();
    app.ad = { ...app.ad, sold: true };
    app.ext = true;
    await app.start();
    expect(app.errors).toContain("Подтвердите проверку данных");
    expect(app.errors).toContain(
      "Товар продан, в архиве или отсутствует в наличии",
    );
  });
});
