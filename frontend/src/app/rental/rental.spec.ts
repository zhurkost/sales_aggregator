import { describe, it, expect, vi, afterEach } from "vitest";
import { AddressInputComponent } from "./address-input.component";
import { RentalEditorComponent } from "./rental-editor.component";
import { applicable } from "./conditions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

describe("rental preparation editor", () => {
  it("flushes edits made during an in-flight save before leaving", async () => {
    const c = new RentalEditorComponent();
    c.workspaceId = "a";
    c.changed();
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/drafts")) return response({ drafts: [] });
        writes++;
        if (writes === 1) {
          c.draft.values["listing.title"] = "Latest";
          c.changed();
        }
        return response({ revision: writes });
      }),
    );
    await c.flush();
    expect(writes).toBe(2);
    expect(c.dirty).toBe(false);
    c.ngOnDestroy();
  });
  it("keeps the new query when clearing a previous address and resets on another draft", () => {
    const c = new AddressInputComponent();
    c.draftId = "one";
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
    c.value = null;
    expect(c.query).toBe("New");
    c.draftId = "two";
    expect(c.query).toBe("");
    c.ngOnDestroy();
  });
  it("keeps dependent choices unknown until their typed prerequisite is chosen", () => {
    const condition = {
      not: { option_id: "owner", operator: "equals", value: true },
    };
    expect(applicable(condition, {})).toBeNull();
    expect(applicable(condition, { owner: false })).toBe(true);
    expect(
      applicable(
        { option_id: "town", operator: "equals", value: 5 },
        { town: "5" },
      ),
    ).toBe(false);
    expect(
      applicable(
        { option_id: "town", operator: "equals", value: 5 },
        { town: 5 },
      ),
    ).toBe(true);
  });
  it("shows only the address fields for the chosen region", () => {
    const c = new RentalEditorComponent();
    c.schema = {
      category: { options: [] },
      canonicalValues: {},
      version: "1",
      addressSuggestions: true,
      platforms: {
        example: {
          labels: {},
          choiceLabels: {},
          constants: { route: "rent" },
          bindings: [],
          extras: [
            {
              id: "area-a",
              name: "A",
              description: "",
              type: "enum",
              options: [],
              fill_rule: {},
              uiWhen: { option_id: "region", operator: "equals", value: "a" },
            },
            {
              id: "area-b",
              name: "B",
              description: "",
              type: "enum",
              options: [],
              fill_rule: {},
              uiWhen: { option_id: "region", operator: "equals", value: "b" },
            },
          ],
        },
      },
    };
    expect(c.availableExtras("example")).toHaveLength(0);
    expect(c.waitingExtras("example")).toBe(true);
    c.draft.extras["example"] = { region: "b" };
    expect(c.availableExtras("example").map((f) => f.id)).toEqual(["area-b"]);
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
  it("invalidates coordinates when the confirmed address changes", () => {
    const c = new RentalEditorComponent();
    c.draft.address = {
      provider: "dadata",
      label: "Old",
      countryIso: "BY",
      settlement: "Old",
      street: "Old",
      house: "1",
      confirmed: true,
    };
    c.draft.values["location.latitude"] = "53.9";
    c.addressChanged(null);
    expect(c.draft.values["location.latitude"]).toBe("");
    expect(c.draft.address).toBeNull();
    c.ngOnDestroy();
  });
  it("keeps typed numeric text exact until server conversion", () => {
    const c = new RentalEditorComponent();
    const field = {
      id: "amount",
      name: "Amount",
      description: "",
      type: "number",
      fill_rule: {},
      options: [],
    };
    c.setExtra("example", field, "1,123456789012345678");
    expect(c.extra("example", "amount")).toBe("1,123456789012345678");
    c.ngOnDestroy();
  });
  it("does not lose edits made during a save and pins workspace", async () => {
    const c = new RentalEditorComponent();
    c.workspaceId = "original";
    c.changed();
    let finish!: (r: Response) => void;
    const fetch = vi.fn((url: string, init?: RequestInit) =>
      url.endsWith("/drafts")
        ? Promise.resolve(response({ drafts: [] }))
        : new Promise<Response>((r) => (finish = r)),
    );
    vi.stubGlobal("fetch", fetch);
    const save = c.save();
    await Promise.resolve();
    await Promise.resolve();
    c.draft.values["listing.title"] = "New";
    c.changed();
    finish(response({ revision: 1 }));
    await save;
    expect(c.dirty).toBe(true);
    expect(c.revision).toBe(1);
    expect(
      (fetch.mock.calls[0][1]?.headers as Record<string, string>)[
        "X-Autopost-Workspace"
      ],
    ).toBe("original");
    c.ngOnDestroy();
  });
  it("keeps conflicting edits instead of resetting the form", async () => {
    const c = new RentalEditorComponent();
    c.workspaceId = "a";
    c.draft.values["listing.title"] = "Keep";
    c.changed();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Конфликт" }), { status: 409 }),
      ),
    );
    await expect(c.save()).rejects.toThrow("Конфликт");
    expect(c.dirty).toBe(true);
    expect(c.draft.values["listing.title"]).toBe("Keep");
    c.ngOnDestroy();
  });
});
