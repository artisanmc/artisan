import type { Condition } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { conditionSummary, conditionsSummary } from "./labels";

describe("conditionSummary", () => {
  it("renders has_permission with the perm slug", () => {
    const c: Condition = { type: "has_permission", perm: "artisan.vip" };
    expect(conditionSummary(c)).toBe('has perm "artisan.vip"');
  });

  it("renders placeholder_equals as `placeholder = value`", () => {
    const c: Condition = {
      type: "placeholder_equals",
      placeholder: "{shop.rarity}",
      value: "legendary",
    };
    expect(conditionSummary(c)).toBe('{shop.rarity} = "legendary"');
  });

  it("renders placeholder_match as `placeholder ~ regex`", () => {
    const c: Condition = {
      type: "placeholder_match",
      placeholder: "{shop.name}",
      regex: "^Diamond.*",
    };
    expect(conditionSummary(c)).toBe("{shop.name} ~ /^Diamond.*/");
  });

  it("composes the new types inside AND/NOT", () => {
    const c: Condition = {
      type: "and",
      of: [
        { type: "has_permission", perm: "shop.use" },
        {
          type: "not",
          of: { type: "placeholder_equals", placeholder: "{shop.rarity}", value: "legendary" },
        },
      ],
    };
    expect(conditionSummary(c)).toBe('(has perm "shop.use" AND NOT ({shop.rarity} = "legendary"))');
  });
});

describe("conditionsSummary", () => {
  it("joins top-level conditions with their AND/OR operators", () => {
    const conditions: Condition[] = [
      { type: "has_permission", perm: "a" },
      { type: "has_level", level: 5 },
      { type: "world_is", world: "nether" },
    ];
    expect(conditionsSummary(conditions, ["or"])).toBe(
      'has perm "a" OR level ≥ 5 AND world = "nether"',
    );
  });
});
