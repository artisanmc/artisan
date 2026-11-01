import { describe, expect, it } from "vitest";
import {
  conditionOfCriterion,
  parseVariableCondition,
  serializeVariableCondition,
  variableCriterionOf,
} from "./variableCondition";

describe("variableCondition", () => {
  it.each([
    ["var.guilds.has_guild", { name: "guilds.has_guild", key: null, op: "is", value: null }],
    ["!var.guilds.has_guild", { name: "guilds.has_guild", key: null, op: "is_not", value: null }],
    ["var.guilds.level >= 3", { name: "guilds.level", key: null, op: ">=", value: 3 }],
    [
      'var.quests.status["daily/miner"] == "completed"',
      { name: "quests.status", key: "daily/miner", op: "==", value: "completed" },
    ],
    ["var.", { name: "", key: null, op: "is", value: null }],
  ])("reads %s and writes it back as is", (expr, parsed) => {
    expect(parseVariableCondition(expr)).toEqual(parsed);
    expect(serializeVariableCondition(parsed as never)).toBe(expr);
  });

  it("keeps quotes and backslashes of a key and a value", () => {
    const c = { name: "quests.status", key: 'a"b', op: "!=" as const, value: 'x\\"y' };
    expect(parseVariableCondition(serializeVariableCondition(c))).toEqual(c);
  });

  it.each([
    "player.level > 3",
    "var.guilds.level > 3 && var.guilds.has_guild",
    "!var.guilds.level > 3",
    "var.guilds.level > other",
    "variable.x",
  ])("leaves %s to the expression field", (expr) => {
    expect(parseVariableCondition(expr)).toBeNull();
  });
});

describe("a criterion on a Variable as a condition", () => {
  it.each([
    ["var.vip", { name: "vip", key: null, op: "is", value: null }],
    ["var.coins >= 10", { name: "coins", key: null, op: ">=", value: 10 }],
  ])("reads the bare id of a Project variable in %s", (expr, parsed) => {
    expect(parseVariableCondition(expr)).toEqual(parsed);
  });

  it("writes is set as has_var, with its key, and reads it back", () => {
    const c = { name: "quests.status", key: "daily", op: "is_set" as const, value: null };
    const written = conditionOfCriterion(c);
    expect(written).toEqual({ type: "has_var", var: 'quests.status["daily"]' });
    expect(variableCriterionOf(written)).toEqual(c);
    expect(variableCriterionOf({ type: "has_var", var: "last_death" })).toEqual({
      name: "last_death",
      key: null,
      op: "is_set",
      value: null,
    });
  });

  it("writes the other operators as an expression, and ignores other conditions", () => {
    expect(conditionOfCriterion({ name: "vip", key: null, op: "is_not", value: null })).toEqual({
      type: "expression",
      expr: "!var.vip",
    });
    expect(variableCriterionOf({ type: "has_permission", perm: "x" })).toBeNull();
    expect(variableCriterionOf({ type: "has_var", var: "not a name" })).toBeNull();
  });
});
