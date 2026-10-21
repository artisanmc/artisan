import type { PlayerCommand } from "@/lib/api/playerCommands";
import { parseOverride } from "@/lib/commandOverride";
import { commandTextRows, textIn, withTexts } from "@/lib/moduleCommandTexts";
import type { ModuleCommandEntry } from "@/lib/moduleCommands";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const command: PlayerCommand = {
  id: "daily:claim",
  moduleId: "daily",
  name: "daily",
  aliases: [],
  permission: null,
  description: { fr: "Récupère", en: "Claim" },
  arguments: [],
  consoleAllowed: false,
  opensMenu: null,
  children: [],
};

const entry = (yaml?: string): ModuleCommandEntry => ({
  command,
  override: yaml
    ? (parseOverride("daily", "overrides/command/daily.claim.yaml", yaml) ?? undefined)
    : undefined,
  root: true,
  label: "daily",
});

describe("module command texts", () => {
  it("lists the description, the module's until the override sets one, and a cooldown's message", () => {
    expect(commandTextRows([entry()]).map((r) => [r.key, r.values])).toEqual([
      ["daily:claim#description", { fr: "Récupère", en: "Claim" }],
    ]);
    const rows = commandTextRows([
      entry(
        "command: daily:claim\ndescription: { fr: Prends }\ncooldown: { duration_seconds: 60, message: Attends }\n",
      ),
    ]);
    expect(rows.map((r) => [r.field, r.values, r.original])).toEqual([
      ["description", { fr: "Prends" }, { fr: "Récupère", en: "Claim" }],
      ["cooldown_message", { "*": "Attends" }, {}],
    ]);
  });

  it("reads a language, else the text written for every language", () => {
    expect(textIn({ fr: "a", "*": "b" }, "fr")).toBe("a");
    expect(textIn({ fr: "a", "*": "b" }, "de")).toBe("b");
    expect(textIn({ fr: "a" }, "de")).toBe("");
  });

  it("writes the texts over the file, keeping what it already sets", () => {
    const content = withTexts(
      entry(
        "command: daily:claim\nname: reward\ncooldown: { duration_seconds: 60 }\nrequirements: [{ type: x }]\n",
      ),
      {
        description: { fr: "Récupère", en: "Claim", de: "Hol" },
        cooldown_message: { fr: "Attends" },
      },
    );
    expect(parse(content)).toEqual({
      schema: "command_override/v1",
      command: "daily:claim",
      name: "reward",
      requirements: [{ type: "x" }],
      cooldown: { duration_seconds: 60, scope: "player", message: { fr: "Attends" } },
      description: { fr: "Récupère", en: "Claim", de: "Hol" },
    });
  });

  it("writes nothing for texts back to the module's", () => {
    const content = withTexts(entry(), { description: { en: "Claim", fr: "Récupère" } });
    expect(parse(content)).toEqual({ schema: "command_override/v1", command: "daily:claim" });
  });
});
