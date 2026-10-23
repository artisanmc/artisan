import type { Project } from "@/domain/types";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import { type StoredOverride, parseOverride } from "@/lib/commandOverride";
import { isModuleCommandId, moduleCommandsOf, withModuleCommands } from "@/lib/moduleCommands";
import { describe, expect, it } from "vitest";
import { deriveEdges } from "./deriveEdges";
import { MODULE_COMMAND_ROWS, commandBox } from "./menuLayout";
import { deriveServerGraph, documentKey } from "./serverGraph";
import { subCommandAnchors } from "./subCommandAnchors";

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

  it("draws one node per root, its sub-commands as rows, their links from the root", () => {
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
    expect(nodes.map((n) => n.label)).toEqual(["g"]);
    expect(nodes[0]?.children.map((c) => [c.label, c.depth, c.state])).toEqual([
      ["balance", 1, "default"],
      ["balance add", 2, "modified"],
      ["invite", 1, "default"],
    ]);
    // The node's chain gathers the menu a sub-command opens.
    expect(nodes[0]?.command.steps.length).toBe(1);
  });

  it("anchors a sub-command's link on its row, a link of the root's own on the node", () => {
    const ah = command("auctions:ah", {
      name: "ah",
      children: [
        command("auctions:sell", { name: "sell" }),
        command("auctions:claim", { name: "claim" }),
      ],
    });
    const overrides = {
      "auctions:claim": override(
        "auctions",
        "command: auctions:claim\nsteps:\n  - open_menu: claims\n",
      ),
      "auctions:ah": override("auctions", "command: auctions:ah\nsteps:\n  - open_menu: main\n"),
    };
    const project = folder("auctions", ["claims", "main"]);
    const nodes = moduleCommandsOf(project, {
      commands: [ah],
      overrides,
      folders: [{ folder: "auctions", ownerModule: "auctions" }],
    });
    const board = withModuleCommands(project, nodes);
    const src = { x: 0, y: 0, ...commandBox(nodes[0]!.command) };
    const boxes = {
      "auctions:ah": src,
      claims: { x: 400, y: 0, width: 200, height: 100 },
      main: { x: 400, y: 300, width: 200, height: 100 },
    };
    const anchors = subCommandAnchors(board, deriveEdges(board), boxes);
    const rowMid =
      MODULE_COMMAND_ROWS.header + MODULE_COMMAND_ROWS.row + (MODULE_COMMAND_ROWS.row - 3) / 2;
    expect(anchors).toEqual({
      "auctions:ah->claims": { from: { side: "right", t: rowMid / src.height } },
    });
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
