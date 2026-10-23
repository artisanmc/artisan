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
      { ...command("attribution:open"), permission: "artisan.open" },
      {
        enabled: true,
        name: " Parrain ",
        aliases: ["p", " "],
        permission: "artisan.open",
        description: { fr: "Parrainage", en: "" },
        cooldown: { duration: 10, scope: "player" },
      },
      previous,
    );
    expect(parse(out)).toEqual({
      schema: "command_override/v1",
      command: "attribution:open",
      requirements: [{ type: "permission", permission: "x" }],
      cooldown: { id: "shared", duration_seconds: 10, scope: "player" },
      name: "parrain",
      aliases: ["p"],
      description: { fr: "Parrainage" },
    });
    expect(out).toContain("# permission: artisan.open");
  });

  it("edits the steps that replace the module's code, and drops them to run it again", () => {
    const previous = "command: attribution:open\nsteps: [{ message: hi }]\n";
    const read = parseOverride("x", "overrides/command/x.yaml", previous);
    expect(read?.fields.steps).toEqual([{ message: "hi" }]);
    expect(read?.hasLogic).toBe(false);
    const declared = command("attribution:open");
    const steps = [{ module_command: { command: "attribution:open" } }];
    expect(parse(serializeOverride(declared, { enabled: true, steps }, previous)).steps).toEqual(
      steps,
    );
    expect(parse(serializeOverride(declared, { enabled: true }, previous)).steps).toBeUndefined();
    expect(
      parse(serializeOverride(declared, { enabled: true, steps: [] }, previous)).steps,
    ).toBeUndefined();
  });

  it("keeps the file once nothing is left to override, the module's values as comments", () => {
    const declared: PlayerCommand = {
      ...command("attribution:open"),
      aliases: ["parrain"],
      permission: "artisan.open",
      description: { fr: "Ouvre", en: "Opens" },
    };
    const previous = "schema: command_override/v1\ncommand: attribution:open\nenabled: false\n";
    const fields = {
      enabled: true,
      name: "open",
      aliases: ["parrain"],
      description: { en: "Opens", fr: "Ouvre" },
    };
    const out = serializeOverride(declared, fields, previous);
    expect(out).toBe(
      [
        "schema: command_override/v1",
        "command: attribution:open",
        "# The module's values. Uncomment a line to change it; delete this file to go back to them.",
        "# name: open",
        "# aliases:",
        "#   - parrain",
        "# permission: artisan.open",
        "# description:",
        "#   en: Opens",
        "#   fr: Ouvre",
        "",
      ].join("\n"),
    );
    const stored = parseOverride("attribution", "overrides/command/a.yaml", out);
    expect(stored?.fields).toEqual({ enabled: true });
    expect(overrideState(stored ?? undefined)).toBe("default");
    expect(serializeOverride(declared, fields, previous, false)).not.toContain("# name:");
  });

  it("keeps an empty permission when the module asks for one: the command needs none", () => {
    const declared = { ...command("attribution:open"), permission: "artisan.open" };
    const out = serializeOverride(declared, { enabled: true, permission: "" }, null);
    expect(parse(out)).toMatchObject({ permission: "" });
    expect(
      parse(serializeOverride(command("a:b"), { enabled: true, permission: "" }, null)),
    ).toEqual({ schema: "command_override/v1", command: "a:b" });
  });

  it("counts as modified only a file that sets something", () => {
    const read = (yaml: string) =>
      parseOverride("x", "overrides/command/x.yaml", yaml) ?? undefined;
    expect(overrideState(read("command: a:b\n# name: c\n"))).toBe("default");
    expect(overrideState(read("command: a:b\nname: c\n"))).toBe("modified");
    expect(overrideState(read("command: a:b\nsteps: [{ message: hi }]\n"))).toBe("modified");
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
