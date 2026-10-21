import type { PlayerCommand } from "@/lib/api/playerCommands";
import {
  overrideFolder,
  overridePath,
  overrideState,
  parseOverride,
  serializeOverride,
} from "@/lib/commandOverride";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const command = (id: string, moduleId: string | null = null): PlayerCommand => ({
  id,
  moduleId,
  name: "open",
  aliases: [],
  permission: null,
  description: {},
  arguments: [],
  consoleAllowed: false,
  opensMenu: null,
  children: [],
});

describe("command overrides", () => {
  it("names the file after the command id", () => {
    expect(overridePath("attribution:open")).toBe("overrides/command/attribution.open.yaml");
  });

  it("reads what the form edits, and notes the logic it does not", () => {
    const override = parseOverride(
      "attribution",
      "overrides/command/a.yaml",
      [
        "schema: command_override/v1",
        "command: attribution:open",
        "enabled: false",
        "permission: ''",
        "description: Ouvre le menu",
        "cooldown: { duration_seconds: 30, scope: global }",
        "requirements: [{ type: permission, permission: x }]",
      ].join("\n"),
    );
    expect(override?.fields).toEqual({
      enabled: false,
      permission: "",
      description: { "*": "Ouvre le menu" },
      cooldown: { duration: 30, scope: "global" },
    });
    expect(override?.hasLogic).toBe(true);
    expect(overrideState(override ?? undefined)).toBe("disabled");
  });

  it("ignores a file that names no command", () => {
    expect(
      parseOverride("x", "overrides/command/x.yaml", "schema: command_override/v1"),
    ).toBeNull();
  });

  it("writes only what differs from the module, over what the form does not edit", () => {
    const previous = [
      "schema: command_override/v1",
      "command: attribution:open",
      "requirements: [{ type: permission, permission: x }]",
      "cooldown: { id: shared, duration_seconds: 5 }",
    ].join("\n");
    const out = serializeOverride(
      "attribution:open",
      {
        enabled: true,
        name: " Parrain ",
        aliases: ["p", " "],
        description: { fr: "Parrainage", en: "" },
        cooldown: { duration: 10, scope: "player" },
      },
      previous,
    );
    expect(parse(out ?? "")).toEqual({
      schema: "command_override/v1",
      command: "attribution:open",
      requirements: [{ type: "permission", permission: "x" }],
      cooldown: { id: "shared", duration_seconds: 10, scope: "player" },
      name: "parrain",
      aliases: ["p"],
      description: { fr: "Parrainage" },
    });
  });

  it("deletes the file once nothing is left to override", () => {
    const previous = "schema: command_override/v1\ncommand: attribution:open\nenabled: false\n";
    expect(serializeOverride("attribution:open", { enabled: true }, previous)).toBeNull();
  });

  it("keeps an empty permission: the command needs none", () => {
    const out = serializeOverride("attribution:open", { enabled: true, permission: "" }, null);
    expect(parse(out ?? "")).toMatchObject({ permission: "" });
  });

  it("writes beside an existing override, else in its module's folder, else its namespace's", () => {
    const folders = [
      { folder: "attribution_config", ownerModule: "attribution" },
      { folder: "auctions", ownerModule: null },
    ];
    expect(overrideFolder(command("attribution:open", "attribution"), undefined, folders)).toBe(
      "attribution_config",
    );
    expect(overrideFolder(command("auctions:ah"), undefined, folders)).toBe("auctions");
    expect(overrideFolder(command("daily:claim", "daily"), undefined, folders)).toBeNull();
    const existing = parseOverride("lobby", "overrides/command/a.yaml", "command: auctions:ah");
    expect(overrideFolder(command("auctions:ah"), existing ?? undefined, folders)).toBe("lobby");
  });
});
