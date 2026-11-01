import { commandsOf } from "@/domain/documents";
import type { Command, ProjectId } from "@/domain/types";
import { createVersion, showVariant } from "@/domain/variants";
import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { commandVariantOverlay, mergeCommandVariant } from "./commandVariant";
import { projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

const PID = "p_cmdvariant" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

const MODULE = {
  schema: "command/v1",
  name: "guild",
  aliases: ["g"],
  permission: "guilds.use",
  actions: "open_menu guild_home",
  subcommands: [
    { name: "info", actions: "open_menu info" },
    { name: "top", actions: "open_menu top", fallback: "message nope" },
  ],
};

describe("mergeCommandVariant / commandVariantOverlay (the plugin's CommandVariant)", () => {
  it("puts the variant's steps on the module's command, sub-commands by name", () => {
    const merged = mergeCommandVariant(MODULE, {
      schema: "command/v1",
      actions: "open_dialog guild_home",
      subcommands: [{ name: "INFO", actions: "open_dialog info" }],
    });
    expect(merged).toEqual({
      ...MODULE,
      actions: "open_dialog guild_home",
      subcommands: [{ name: "info", actions: "open_dialog info" }, MODULE.subcommands[1]],
    });
  });

  it("refuses what the plugin refuses: a registration key, an unknown sub-command", () => {
    expect(mergeCommandVariant(MODULE, { aliases: ["x"] })).toBeNull();
    expect(
      mergeCommandVariant(MODULE, { subcommands: [{ name: "nope", actions: "x" }] }),
    ).toBeNull();
    expect(
      mergeCommandVariant(MODULE, { subcommands: [{ name: "info", permission: "x" }] }),
    ).toBeNull();
  });

  it("writes only the steps that differ; a dropped step is written empty", () => {
    const full = {
      ...MODULE,
      actions: "open_dialog guild_home",
      subcommands: [MODULE.subcommands[0], { name: "top", actions: "open_menu top" }],
    };
    expect(commandVariantOverlay(MODULE, full)).toEqual({
      schema: "command/v1",
      actions: "open_dialog guild_home",
      subcommands: [{ name: "top", fallback: null }],
    });
    expect(commandVariantOverlay(MODULE, MODULE)).toEqual({ schema: "command/v1" });
  });
});

describe("a command's version in a project", () => {
  const files = {
    [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
    [`${base}/variants.yml`]: "schema: variants/v1\nrules:\n  - variant: bedrock\n",
    [`${base}/commands/guild.yml`]:
      "schema: command/v1\naliases: [g]\npermission: guilds.use\nactions:\n  - open_menu: guild_home\nsubcommands:\n  - name: info\n    actions:\n      - open_menu: info\n",
    [`${base}/variants/bedrock/commands/guild.yml`]:
      "schema: command/v1\nactions:\n  - open_dialog: guild_home\n",
  };

  it("reads whole, writes only its steps, as a fixed point", () => {
    const project = projectFromFiles(PID, files);
    const version = project.variants?.documents.bedrock?.command?.[0] as Command;
    expect(version.id).toBe("guild");
    expect(version.aliases).toEqual(["g"]);
    expect(version.subcommands?.map((s) => s.name)).toEqual(["info"]);
    expect(project.unreadFiles?.[`${base}/variants/bedrock/commands/guild.yml`]).toBeUndefined();
    const out = projectToFiles(project);
    expect(parse(out[`${base}/variants/bedrock/commands/guild.yml`]!)).toEqual({
      schema: "command/v1",
      actions: [{ open_dialog: "guild_home" }],
    });
    expect(projectToFiles(projectFromFiles(PID, out))).toEqual(out);
  });

  it("shows the module's registration as it is now, with the version's steps", () => {
    const project = produce(projectFromFiles(PID, files), (p) => {
      const own = commandsOf(p)[0]!;
      own.aliases = ["g", "guilde"];
      showVariant(p, "bedrock");
    });
    const shown = commandsOf(project)[0]!;
    expect(shown.aliases).toEqual(["g", "guilde"]);
    expect(JSON.stringify(shown.steps)).toContain("open_dialog");
    const out = projectToFiles(project);
    expect(parse(out[`${base}/commands/guild.yml`]!).aliases).toEqual(["g", "guilde"]);
    expect(parse(out[`${base}/variants/bedrock/commands/guild.yml`]!)).toEqual({
      schema: "command/v1",
      actions: [{ open_dialog: "guild_home" }],
    });
  });

  it("a new version of a command writes nothing but its schema until its steps change", () => {
    const only = { ...files };
    delete only[`${base}/variants/bedrock/commands/guild.yml`];
    const project = produce(projectFromFiles(PID, only), (p) => {
      showVariant(p, "bedrock");
      expect(createVersion(p, "command", "guild")).toBe(true);
    });
    const out = projectToFiles(project);
    expect(parse(out[`${base}/variants/bedrock/commands/guild.yml`]!)).toEqual({
      schema: "command/v1",
    });
  });
});
