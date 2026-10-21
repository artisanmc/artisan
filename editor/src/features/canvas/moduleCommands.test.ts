import type { Project } from "@/domain/types";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import { type StoredOverride, parseOverride } from "@/lib/commandOverride";
import { describe, expect, it } from "vitest";
import { isModuleCommandId, moduleCommandsOf, withModuleCommands } from "./moduleCommands";
import { deriveServerGraph, documentKey } from "./serverGraph";

const command = (id: string, over: Partial<PlayerCommand> = {}): PlayerCommand => ({
  id,
  moduleId: id.slice(0, id.indexOf(":")),
  name: id.slice(id.indexOf(":") + 1),
  aliases: [],
  permission: null,
  description: {},
  arguments: [],
  consoleAllowed: false,
  opensMenu: null,
  children: [],
  ...over,
});

function folder(id: string, menus: string[] = []): Project {
  return {
    id,
    name: id,
    canvasLayout: {},
    documents: {
      menu: menus.map((m) => ({ id: m, rows: 3, layers: [] })),
      command: [],
      dialog: [],
    },
  } as unknown as Project;
}

const override = (folderId: string, yaml: string): StoredOverride =>
  parseOverride(folderId, "overrides/command/x.yaml", yaml)!;

const boutique = command("boutique:open", {
  name: "boutique",
  opensMenu: "boutique_addon:shop_main",
});
const folders = [
  { folder: "boutique_addon", ownerModule: "boutique" },
  { folder: "spawn", ownerModule: null },
];

describe("module commands on the board", () => {
  it("draws a module's command in its folder, linked to the menu it declares", () => {
    const project = folder("boutique_addon", ["shop_main"]);
    const nodes = moduleCommandsOf(project, { commands: [boutique], overrides: {}, folders });
    expect(nodes.map((n) => [n.id, n.label, n.state, n.runs])).toEqual([
      ["boutique:open", "boutique", "default", "menu"],
    ]);
    const graph = deriveServerGraph([withModuleCommands(project, nodes)]);
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      [documentKey("boutique_addon", "boutique:open"), documentKey("boutique_addon", "shop_main")],
    ]);
  });

  it("draws nothing in a folder of another module", () => {
    const nodes = moduleCommandsOf(folder("spawn"), {
      commands: [boutique],
      overrides: {},
      folders,
    });
    expect(nodes).toEqual([]);
  });

  it("follows the override: its folder, its name and its steps replace the menu", () => {
    const overrides = {
      "boutique:open": override(
        "spawn",
        "command: boutique:open\nname: shop\nsteps:\n  - open_menu: closed\n",
      ),
    };
    const input = { commands: [boutique], overrides, folders };
    expect(moduleCommandsOf(folder("boutique_addon"), input)).toEqual([]);
    const project = folder("spawn", ["closed"]);
    const [node] = moduleCommandsOf(project, input);
    expect([node?.label, node?.state, node?.runs]).toEqual(["shop", "modified", "steps"]);
    const graph = deriveServerGraph([withModuleCommands(project, node ? [node] : [])]);
    expect(graph.edges.map((e) => e.target)).toEqual([documentKey("spawn", "closed")]);
  });

  it("shows a sub-command only when it links somewhere, under its root's name", () => {
    const guilds = command("guilds:guild", {
      name: "g",
      children: [
        command("guilds:balance", {
          name: "balance",
          children: [command("guilds:balance.add", { name: "add" })],
        }),
        command("guilds:invite", { name: "invite" }),
      ],
    });
    const overrides = {
      "guilds:balance.add": override(
        "guilds",
        "command: guilds:balance.add\nsteps:\n  - open_menu: confirm\n",
      ),
    };
    const nodes = moduleCommandsOf(folder("guilds", ["confirm"]), {
      commands: [guilds],
      overrides,
      folders: [{ folder: "guilds", ownerModule: "guilds" }],
    });
    expect(nodes.map((n) => n.label)).toEqual(["g", "g balance add"]);
  });

  it("marks a disabled command, and its id never passes for a Document id", () => {
    const overrides = {
      "boutique:open": override("boutique_addon", "command: boutique:open\nenabled: false\n"),
    };
    const [node] = moduleCommandsOf(folder("boutique_addon"), {
      commands: [boutique],
      overrides,
      folders,
    });
    expect([node?.state, node?.runs]).toEqual(["disabled", "menu"]);
    expect(isModuleCommandId("boutique:open")).toBe(true);
    expect(isModuleCommandId("shop_main")).toBe(false);
  });

  it("leaves the project untouched without module commands", () => {
    const project = folder("spawn");
    expect(withModuleCommands(project, [])).toBe(project);
  });
});
