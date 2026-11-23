import { MAX_REFRESH_TICKS, MIN_REFRESH_TICKS, clampRefreshTicks } from "@/domain/elementRefresh";
import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("refresh_ticks on an element", () => {
  const wire = {
    schema: "menu/v1",
    id: "event",
    title: [],
    size: 27,
    elements: [
      {
        id: "timer",
        positions: 4,
        material: "CLOCK",
        title: "Ends in {event.end.until()}",
        refresh_ticks: 20,
      },
      { id: "plain", positions: 5, material: "STONE" },
    ],
  };

  it("round-trips, and stays absent on an element without it", () => {
    expect(validateMenuV1(wire)).toEqual({ valid: true, errors: [] });
    const { menu, i18nKeys } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "en" });
    const [timer, plain] = menu.layers[0]!.elements;
    expect(timer!.refreshTicks).toBe(20);
    expect(plain!.refreshTicks).toBeUndefined();
    const out = menuV1FromDomain(menu, { id: "p", defaultLang: "en", i18nKeys } as Project);
    const elements = (out as unknown as { elements: Record<string, unknown>[] }).elements;
    expect(elements[0]!.refresh_ticks).toBe(20);
    expect("refresh_ticks" in elements[1]!).toBe(false);
    expect(validateMenuV1(out).valid).toBe(true);
  });

  it.each([1, 0, 2.5, 72001, "20"])("the schema refuses refresh_ticks %j", (value) => {
    const bad = { ...wire, elements: [{ ...wire.elements[0], refresh_ticks: value }] };
    expect(validateMenuV1(bad).valid).toBe(false);
  });

  it("the editor writes nothing for an empty or zero value and clamps the rest", () => {
    expect(clampRefreshTicks(undefined)).toBeUndefined();
    expect(clampRefreshTicks(0)).toBeUndefined();
    expect(clampRefreshTicks(Number.NaN)).toBeUndefined();
    expect(clampRefreshTicks(1)).toBe(MIN_REFRESH_TICKS);
    expect(clampRefreshTicks(0.5 * 20)).toBe(10);
    expect(clampRefreshTicks(10 ** 9)).toBe(MAX_REFRESH_TICKS);
  });
});
