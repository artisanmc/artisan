import { describe, expect, it } from "vitest";
import { parseVariableCondition, serializeVariableCondition } from "./variableCondition";

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
