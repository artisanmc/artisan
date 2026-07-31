import { describe, expect, it } from "vitest";
import type { Appearance, Element, Placement, Project } from "@/domain/types";
import {
  capturePlacementCache,
  matchPlacementRow,
  placementTotalPages,
  resolvePlacementSlot,
} from "./placement";

// Minimal pack whose i18nKeys back a couple of title/lore templates.
function makePack(): Project {
  return {
    id: "p1" as Project["id"],
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {
      title1: { en: "{item.name}" },
      lore1: { en: "Price: {item.price}" },
      ovr1: { en: "SALE {item.name}" },
    } as Project["i18nKeys"],
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as Project;
}

const PLACES = (over: Partial<NonNullable<Element["places"]>> = {}): NonNullable<Element["places"]> => ({
  source: "shops",
  alias: "item",
  keyField: "id",
  placements: [],
  ...over,
});

// Build appearance with a real LText title.
const APP = (over: Partial<Appearance> = {}): Appearance => ({
  material: "{item.material}",
  count: 1,
  title: { key: "title1" } as Appearance["title"],
  ...over,
});

describe("placementTotalPages", () => {
  it("is max(page)+1, min 1", () => {
    expect(placementTotalPages([])).toBe(1);
    expect(placementTotalPages([{ key: "a", page: 0, position: 0 }])).toBe(1);
    expect(
      placementTotalPages([
        { key: "a", page: 0, position: 0 },
        { key: "b", page: 2, position: 3 },
      ]),
    ).toBe(3);
  });
});

describe("matchPlacementRow", () => {
  const rows = [
    { id: "sword", material: "DIAMOND_SWORD" },
    { id: "apple", material: "APPLE" },
  ];
  it("matches by keyField value (stringified)", () => {
    expect(matchPlacementRow(rows, "id", "apple")).toEqual({ id: "apple", material: "APPLE" });
    expect(matchPlacementRow([{ id: 42 }], "id", "42")).toEqual({ id: 42 });
  });
  it("returns undefined for a missing key or non-array", () => {
    expect(matchPlacementRow(rows, "id", "ghost")).toBeUndefined();
    expect(matchPlacementRow(undefined, "id", "x")).toBeUndefined();
  });
});

describe("resolvePlacementSlot", () => {
  const pack = makePack();
  const baseCtx = {};

  it("resolves material + title against the bound row (alias binding)", () => {
    const placement: Placement = { key: "sword", page: 0, position: 4 };
    const row = { id: "sword", material: "DIAMOND_SWORD", name: "Sword" };
    const info = resolvePlacementSlot({
      places: PLACES(),
      appearance: APP(),
      placement,
      row,
      rowsAvailable: true,
      baseCtx,
      pack,
      activeLang: "en",
      elementId: "E1",
    });
    expect(info.material).toBe("DIAMOND_SWORD");
    expect(info.title).toBe("Sword");
    expect(info.count).toBe(1);
    expect(info.dangling).toBe(false);
  });

  it("falls back to cachedDisplay when the SOURCE is unreachable (offline)", () => {
    const placement: Placement = {
      key: "sword",
      page: 0,
      position: 4,
      cachedDisplay: { name: "Cached Sword", material: "STONE_SWORD" },
    };
    const info = resolvePlacementSlot({
      places: PLACES(),
      appearance: APP(),
      placement,
      row: undefined,
      rowsAvailable: false, // offline / no snapshot — the cache may render
      baseCtx,
      pack,
      activeLang: "en",
      elementId: "E1",
    });
    expect(info.material).toBe("STONE_SWORD");
    expect(info.title).toBe("Cached Sword");
    expect(info.dangling).toBe(false);
  });

  it("is DANGLING when the source is reachable but the row was removed — cache must NOT ghost-render", () => {
    const placement: Placement = {
      key: "deleted_row",
      page: 0,
      position: 4,
      cachedDisplay: { name: "Ghost", material: "DIAMOND_SWORD" },
    };
    const info = resolvePlacementSlot({
      places: PLACES(),
      appearance: APP(),
      placement,
      row: undefined,
      rowsAvailable: true, // live rows resolved, key simply gone
      baseCtx,
      pack,
      activeLang: "en",
      elementId: "E1",
    });
    expect(info.material).toBeUndefined();
    expect(info.dangling).toBe(true);
  });

  it("is dangling (no material) when neither row nor cache resolves", () => {
    const placement: Placement = { key: "ghost", page: 0, position: 4 };
    const info = resolvePlacementSlot({
      places: PLACES(),
      appearance: APP(),
      placement,
      row: undefined,
      rowsAvailable: false,
      baseCtx,
      pack,
      activeLang: "en",
      elementId: "E1",
    });
    expect(info.material).toBeUndefined();
    expect(info.dangling).toBe(true);
  });

  it("renders variation through the template's conditional context, never an override", () => {
    // No per-placement override exists — the appearance template is the single
    // source of look/behaviour; per-row variation is a conditional state.
    const placement: Placement = { key: "sword", page: 0, position: 4 };
    const row = { id: "sword", material: "GOLD_INGOT", name: "Sword" };
    const info = resolvePlacementSlot({
      places: PLACES(),
      appearance: APP(),
      placement,
      row,
      rowsAvailable: true,
      baseCtx,
      pack,
      activeLang: "en",
      elementId: "E1",
    });
    expect(info.material).toBe("GOLD_INGOT"); // resolved from the row via the template
    expect(info.title).toBe("Sword");
  });
});

describe("capturePlacementCache", () => {
  const pack = makePack();
  it("snapshots the live-resolved name/material/lore for offline fallback", () => {
    const row = { id: "sword", material: "DIAMOND_SWORD", name: "Sword", price: 10 };
    const cache = capturePlacementCache({
      places: PLACES(),
      appearance: APP({ lore: { key: "lore1" } as Appearance["lore"] }),
      row,
      baseCtx: {},
      pack,
      activeLang: "en",
    });
    expect(cache.name).toBe("Sword");
    expect(cache.material).toBe("DIAMOND_SWORD");
    expect(cache.lore).toEqual(["Price: 10"]);
  });
});
