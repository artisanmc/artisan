import { describe, expect, it } from "vitest";
import { migrateTitle } from "./migrateTitle";

describe("migrateTitle", () => {
  it("wraps an LText into a single text layer", () => {
    const result = migrateTitle({ key: "menu.title" } as never);
    expect(result).toEqual([{ kind: "text", value: { key: "menu.title" }, x: 8, y: 5 }]);
  });

  it("returns arrays unchanged", () => {
    const layers = [{ kind: "background", assetId: "asset_a" }] as never;
    expect(migrateTitle(layers)).toBe(layers);
  });

  it("returns [] for null/undefined", () => {
    expect(migrateTitle(null)).toEqual([]);
    expect(migrateTitle(undefined)).toEqual([]);
  });
});
