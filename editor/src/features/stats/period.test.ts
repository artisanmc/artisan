import { describe, expect, it } from "vitest";
import {
  change,
  formatChange,
  formatDuration,
  isCustomPeriod,
  resolvePeriod,
  totals,
  validateStatsSearch,
} from "./period";

const now = new Date("2026-11-16T16:42:09Z");
const hourEnd = Date.parse("2026-11-16T17:00:00Z") / 1000;

describe("stats period", () => {
  it("defaults to the last 7 days by day, ending with the hour in progress", () => {
    const p = resolvePeriod({}, now);
    expect(p.to).toBe(hourEnd);
    expect(p.from).toBe(hourEnd - 7 * 86400);
    expect(p.by).toBe("day");
    expect(p.previous).toEqual({ from: p.from - 7 * 86400, to: p.from });
  });

  it("cuts 24 hours by hour", () => {
    const p = resolvePeriod({ range: "24h" }, now);
    expect(p.to - p.from).toBe(86400);
    expect(p.by).toBe("hour");
  });

  it("reads a custom period from its first day to the end of its last", () => {
    const p = resolvePeriod({ from: "2026-11-01", to: "2026-11-03" }, now);
    expect(p.from).toBe(Math.floor(new Date(2026, 10, 1).getTime() / 1000));
    expect(p.to).toBe(Math.floor(new Date(2026, 10, 4).getTime() / 1000));
    expect(p.by).toBe("day");
    expect(resolvePeriod({ from: "2026-11-01", to: "2026-11-01" }, now).by).toBe("hour");
  });

  it("falls back to the preset when the dates are upside down", () => {
    const search = { from: "2026-11-05", to: "2026-11-01", range: "30d" as const };
    expect(isCustomPeriod(search)).toBe(false);
    expect(resolvePeriod(search, now).to).toBe(hourEnd);
  });

  it("keeps only what a search may hold", () => {
    expect(
      validateStatsSearch({
        tab: "commands",
        range: "1y",
        from: "yesterday",
        player: "Iban",
        compare: "false",
        focus: "shop:main",
      }),
    ).toEqual({ tab: "commands", compare: false, focus: "shop:main" });
    const player = "00000000-0000-0000-0000-00000000000a";
    expect(validateStatsSearch({ range: "90d", player })).toEqual({ range: "90d", player });
  });

  it("adds a series up and compares two totals", () => {
    const point = (count: number, sum: number, max: number) => ({
      start: 0,
      granularity: "day" as const,
      count,
      sum,
      min: 0,
      max,
    });
    expect(totals([point(2, 10, 7), point(0, 0, 0), point(1, 4, 4)])).toEqual({
      count: 3,
      sum: 14,
      max: 7,
    });
    expect(change(150, 100)).toBe(0.5);
    expect(change(5, 0)).toBeNull();
    expect(change(5, undefined)).toBeNull();
    expect(formatChange(0.5, "en")).toBe("+50%");
    expect(formatChange(-0.25, "en")).toBe("−25%");
  });

  it("writes a duration the eye reads", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(12 * 60 + 20)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 05");
  });
});
