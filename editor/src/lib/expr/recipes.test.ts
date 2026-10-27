import { describe, expect, it } from "vitest";
import { RECIPES, recipeVariables } from "./recipes";
import { readExpression } from "./readable";

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

describe("recipes", () => {
  it("writes expressions the rich view reads back", () => {
    const built = [
      recipe("showIf").build({ path: "m.online", negate: true, text: '<red>Absent "loin"' }),
      recipe("yesNo").build({ path: "m.online", text: "<green>Oui", otherwise: "Non" }),
      recipe("byNumber").build({ path: "coins", op: ">=", value: 100, text: "a", otherwise: "b" }),
      recipe("count").build({ path: "members" }),
      recipe("join").build({ path: "tags", separator: "\n" }),
      recipe("timeAgo").build({ path: "m.joined" }),
    ];
    expect(built).toEqual([
      '{!m.online ? "<red>Absent \\"loin\\"" : ""}',
      '{m.online ? "<green>Oui" : "Non"}',
      '{coins >= 100 ? "a" : "b"}',
      "{members.length()}",
      '{tags.join("\\n")}',
      "{m.joined.ago()}",
    ]);
    for (const src of built) expect(readExpression(src.slice(1, -1)).ok).toBe(true);
  });

  it("offers the variables of the right kind, dates by their name", () => {
    const entries = [
      { path: "m.online", type: "boolean" as const },
      { path: "m.joined", type: "integer" as const },
      { path: "m.level", type: "integer" as const },
      { path: "m.joined.ago()", type: "string" as const },
    ];
    expect(recipeVariables(recipe("showIf"), entries).map((e) => e.path)).toEqual(["m.online"]);
    expect(recipeVariables(recipe("timeAgo"), entries).map((e) => e.path)).toEqual(["m.joined"]);
    expect(recipeVariables(recipe("byNumber"), entries).map((e) => e.path)).toEqual([
      "m.joined",
      "m.level",
    ]);
  });
});
