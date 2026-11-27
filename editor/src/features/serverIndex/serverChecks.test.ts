import type { Project } from "@/domain/types";
import type { ElsewhereWhere } from "@/lib/pack/elsewhere";
import { paletteOf } from "@/lib/pack/palette";
import { describe, expect, it } from "vitest";
import { checkImageIssues, checkServerIssues, serverChecksFor } from "./serverChecks";

type Opens = { to: string; kind?: "menu" | "dialog" };

function menu(id: string, opens: Opens[] = []) {
  return {
    id,
    rows: 3,
    layers: [
      {
        id: "l",
        name: "default",
        elements: opens.map((o, i) => ({
          id: `el_${i}`,
          positions: String(i),
          display: {
            material: "PAPER",
            click: {
              left: {
                steps: [
                  {
                    kind: "action",
                    action:
                      o.kind === "dialog"
                        ? { name: "open_dialog", value: o.to }
                        : { name: "open_menu", value: o.to },
                  },
                ],
              },
            },
          },
          states: [],
        })),
      },
    ],
  };
}

interface Docs {
  menus?: ReturnType<typeof menu>[];
  commands?: { id: string; name?: string; aliases?: string[]; opens?: string }[];
  dialogs?: string[];
}

function project(id: string, docs: Docs = {}): Project {
  return {
    id,
    name: id.toUpperCase(),
    documents: {
      menu: docs.menus ?? [],
      command: (docs.commands ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        aliases: c.aliases,
        arguments: [],
        steps: c.opens ? [{ kind: "action", action: { name: "open_menu", value: c.opens } }] : [],
      })),
      dialog: (docs.dialogs ?? []).map((d) => ({ id: d, buttons: [] })),
    },
  } as unknown as Project;
}

describe("checkServerIssues — commands", () => {
  it("flags a command name the game would register twice across projects", () => {
    const issues = checkServerIssues(project("core", { commands: [{ id: "c1", name: "craft" }] }), [
      project("jobs", { commands: [{ id: "c2", name: "craft" }] }),
    ]);
    expect(issues).toEqual([
      {
        kind: "command_conflict",
        name: "craft",
        owners: [
          { namespace: "core", projectName: "CORE", docId: "c1" },
          { namespace: "jobs", projectName: "JOBS", docId: "c2" },
        ],
      },
    ]);
  });

  it("compares names and aliases without regard to case", () => {
    const issues = checkServerIssues(
      project("core", { commands: [{ id: "c1", name: "menu", aliases: ["M"] }] }),
      [project("jobs", { commands: [{ id: "c2", name: "m" }] })],
    );
    expect(issues.map((i) => i.kind === "command_conflict" && i.name)).toEqual(["m"]);
  });

  it("falls back to the id when a command has no name, as the game does", () => {
    const issues = checkServerIssues(project("core", { commands: [{ id: "shop", name: "" }] }), [
      project("jobs", { commands: [{ id: "x", name: "shop" }] }),
    ]);
    expect(issues).toHaveLength(1);
  });

  it("does not flag a command whose alias repeats its own name", () => {
    const issues = checkServerIssues(
      project("core", { commands: [{ id: "c1", name: "menu", aliases: ["menu"] }] }),
      [],
    );
    expect(issues).toEqual([]);
  });

  it("flags two commands of the edited project too", () => {
    const issues = checkServerIssues(
      project("core", {
        commands: [
          { id: "a", name: "same" },
          { id: "b", name: "same" },
        ],
      }),
      [],
    );
    expect(issues).toHaveLength(1);
  });

  it("ignores conflicts between two other projects: this deploy is not what causes them", () => {
    const issues = checkServerIssues(project("core"), [
      project("a", { commands: [{ id: "c1", name: "dup" }] }),
      project("b", { commands: [{ id: "c2", name: "dup" }] }),
    ]);
    expect(issues).toEqual([]);
  });
});

describe("checkServerIssues — ids", () => {
  it("flags a menu id defined in two projects: the game keeps only one", () => {
    const issues = checkServerIssues(project("core", { menus: [menu("main")] }), [
      project("shop", { menus: [menu("main")] }),
    ]);
    expect(issues).toEqual([
      {
        kind: "duplicate_id",
        docKind: "menu",
        id: "main",
        owners: [
          { namespace: "core", projectName: "CORE", docId: "main" },
          { namespace: "shop", projectName: "SHOP", docId: "main" },
        ],
      },
    ]);
  });

  it("flags dialogs the same way, and keeps menus and dialogs apart", () => {
    const issues = checkServerIssues(
      project("core", { menus: [menu("rules")], dialogs: ["help"] }),
      [project("shop", { dialogs: ["rules", "help"] })],
    );
    expect(issues.map((i) => i.kind === "duplicate_id" && `${i.docKind}:${i.id}`)).toEqual([
      "dialog:help",
    ]);
  });

  it("does not count the published copy of the edited project against itself", () => {
    const edited = project("core", { menus: [menu("main")] });
    expect(checkServerIssues(edited, [edited])).toEqual([]);
  });
});

describe("checkServerIssues — links", () => {
  it("flags a link to a document that exists nowhere on the server", () => {
    const issues = checkServerIssues(
      project("core", { menus: [menu("main", [{ to: "fantome" }])] }),
      [],
    );
    expect(issues).toEqual([
      {
        kind: "broken_link",
        reason: "missing",
        targetId: "fantome",
        from: { docId: "main", docKind: "menu" },
      },
    ]);
  });

  it("accepts a link that lands in another project", () => {
    const issues = checkServerIssues(
      project("core", { menus: [menu("main", [{ to: "catalogue" }])] }),
      [project("shop", { menus: [menu("catalogue")] })],
    );
    expect(issues).toEqual([]);
  });

  it("flags a link whose target two other projects define", () => {
    const issues = checkServerIssues(
      project("core", { menus: [menu("main", [{ to: "doublon" }])] }),
      [project("a", { menus: [menu("doublon")] }), project("b", { menus: [menu("doublon")] })],
    );
    expect(issues).toEqual([
      {
        kind: "broken_link",
        reason: "ambiguous",
        targetId: "doublon",
        from: { docId: "main", docKind: "menu" },
      },
    ]);
  });

  it("reports commands and dialogs as the source of a broken link", () => {
    const issues = checkServerIssues(
      project("core", {
        commands: [{ id: "cmd", opens: "nope" }],
        menus: [menu("m", [{ to: "gone", kind: "dialog" }])],
      }),
      [],
    );
    expect(
      issues.map((i) => i.kind === "broken_link" && `${i.from.docKind}:${i.from.docId}`),
    ).toEqual(["command:cmd", "menu:m"]);
  });

  it("treats a local target as resolved: only the duplicate id remains to warn about", () => {
    const issues = checkServerIssues(
      project("core", { menus: [menu("accueil", [{ to: "main" }]), menu("main")] }),
      [project("shop", { menus: [menu("main")] })],
    );
    expect(issues.map((i) => i.kind)).toEqual(["duplicate_id"]);
  });

  it("accepts a qualified link to another project, and flags one to a missing document", () => {
    const issues = checkServerIssues(
      project("core", {
        menus: [menu("accueil", [{ to: "shop:catalogue" }, { to: "shop:absent" }])],
      }),
      [project("shop", { menus: [menu("catalogue")] })],
    );
    expect(issues).toEqual([
      {
        kind: "broken_link",
        reason: "missing",
        targetId: "shop:absent",
        from: { docId: "accueil", docKind: "menu" },
      },
    ]);
  });

  it("does not report the broken links of other projects", () => {
    const issues = checkServerIssues(project("core"), [
      project("shop", { menus: [menu("main", [{ to: "fantome" }])] }),
    ]);
    expect(issues).toEqual([]);
  });
});

describe("serverChecksFor", () => {
  const edited = project("core", { menus: [menu("main", [{ to: "fantome" }])] });

  it("runs the checks once the other projects are read", () => {
    const checks = serverChecksFor(edited, { status: "ready", projects: [], failed: [] });
    expect(checks.status).toBe("ready");
    expect(checks.issues.map((i) => i.kind)).toEqual(["broken_link"]);
  });

  it("says the checks are pending while the other projects load, and never claims they passed", () => {
    for (const status of ["loading"] as const) {
      expect(serverChecksFor(edited, { status, projects: [], failed: [] })).toEqual({
        status: "pending",
        issues: [],
        unreadable: [],
      });
    }
  });

  it("says the checks were skipped when the server's projects could not be read", () => {
    expect(serverChecksFor(edited, { status: "unavailable", projects: [], failed: [] })).toEqual({
      status: "unavailable",
      issues: [],
      unreadable: [],
    });
  });

  it("stays silent when no index was ever started (no server)", () => {
    expect(serverChecksFor(edited, { status: "idle", projects: [], failed: [] }).status).toBe(
      "none",
    );
  });

  it("reports the projects it could not read: the checks are then incomplete", () => {
    const checks = serverChecksFor(edited, { status: "ready", projects: [], failed: ["cassé"] });
    expect(checks.unreadable).toEqual(["cassé"]);
  });
});

describe("checkServerIssues — order", () => {
  it("lists command conflicts, then duplicate ids, then broken links", () => {
    const issues = checkServerIssues(
      project("core", {
        commands: [{ id: "c", name: "x" }],
        menus: [menu("main", [{ to: "gone" }])],
      }),
      [project("a", { commands: [{ id: "d", name: "x" }], menus: [menu("main")] })],
    );
    expect(issues.map((i) => i.kind)).toEqual(["command_conflict", "duplicate_id", "broken_link"]);
  });
});

/** A menu whose title is drawn with `title` and whose buttons show `buttons`. */
function drawn(id: string, title: string[], buttons: string[] = []) {
  return {
    ...menu(id),
    title: title.map((assetId) => ({ kind: "background", assetId })),
    layers: [
      {
        id: "l",
        name: "default",
        elements: buttons.map((asset, i) => ({
          id: `el_${i}`,
          positions: String(i),
          display: { material: "PAPER", image: { asset, width: 1, height: 1 } },
          states: [],
        })),
      },
    ],
  } as unknown as ReturnType<typeof menu>;
}

const holders = (
  over: Partial<Record<"own" | "base" | "common", string[]>> = {},
): ElsewhereWhere => ({
  folder: "core",
  own: (name) => (over.own ?? ["logo"]).includes(name),
  base: (name) => (over.base ?? ["panel"]).includes(name),
  common: (name) => (over.common ?? ["ribbon"]).includes(name),
  modules: [
    { folder: "jobs", own: (name) => name === "anvil" || name === "shared" },
    { folder: "warps", own: (name) => name === "shared" },
  ],
});

describe("checkImageIssues", () => {
  it("says nothing of the module's own images, the base's and the common ones", () => {
    const edited = project("core", {
      menus: [
        drawn("main", ["logo", "panel"], ["ribbon", "kit:panel", "artisan:ribbon", "core:logo"]),
      ],
    });
    expect(checkImageIssues(edited, holders())).toEqual([]);
  });

  it("flags an image no one holds, once, with the menus that name it", () => {
    const edited = project("core", {
      menus: [drawn("shop", ["ghost"]), drawn("main", ["logo"], ["ghost", "ghost"])],
    });
    expect(checkImageIssues(edited, holders())).toEqual([
      { kind: "image_missing", ref: "ghost", menus: ["main", "shop"] },
    ]);
  });

  it("flags a common name the common images lack, and a module's name that module lacks", () => {
    const edited = project("core", {
      menus: [drawn("main", ["artisan:ghost"], ["jobs:ghost"])],
    });
    expect(checkImageIssues(edited, holders()).map((i) => [i.kind, "ref" in i && i.ref])).toEqual([
      ["image_missing", "artisan:ghost"],
      ["image_missing", "jobs:ghost"],
    ]);
  });

  it("flags a name alone that reaches another module's image, naming the first in the pack's order", () => {
    const edited = project("core", {
      menus: [drawn("main", ["anvil"], ["shared"]), drawn("shop", [], ["anvil"])],
    });
    expect(checkImageIssues(edited, holders())).toEqual([
      { kind: "image_elsewhere", ref: "anvil", module: "jobs", menus: ["main", "shop"] },
      { kind: "image_elsewhere", ref: "shared", module: "jobs", menus: ["main"] },
    ]);
  });

  it("says nothing of an image named with its module", () => {
    const edited = project("core", { menus: [drawn("main", ["jobs:anvil"], ["warps:shared"])] });
    expect(checkImageIssues(edited, holders())).toEqual([]);
  });

  it("says nothing of a theme's own image, and flags its name alone", () => {
    const edited = project("core", { menus: [drawn("main", ["noel:star"], ["star"])] });
    const themed = { ...holders(), themes: [{ folder: "noel", own: (n: string) => n === "star" }] };
    expect(checkImageIssues(edited, themed)).toEqual([
      { kind: "image_missing", ref: "star", menus: ["main"] },
    ]);
  });

  it("leaves a name the game fills in alone", () => {
    const edited = project("core", {
      menus: [drawn("main", [], ["{{row.icon}}", "%player_rank%", ""])],
    });
    expect(checkImageIssues(edited, holders())).toEqual([]);
  });

  it("reads the names a kind's file writes as a menu's, and says which files write them", () => {
    const edited = project("core", { menus: [drawn("main", ["ghost"], ["logo"])] });
    const writers = {
      files: [
        { name: "huds/main.yml", refs: ["ghost", "anvil", "logo", "jobs:anvil", "{{row.icon}}"] },
        { name: "huds/boss.yml", refs: ["anvil"] },
      ],
      composed: [],
      png: () => true,
    };
    expect(checkImageIssues(edited, holders(), writers)).toEqual([
      { kind: "image_missing", ref: "ghost", menus: ["main"], files: ["huds/main.yml"] },
      {
        kind: "image_elsewhere",
        ref: "anvil",
        module: "jobs",
        menus: [],
        files: ["huds/boss.yml", "huds/main.yml"],
      },
    ]);
  });

  it("flags the layers of a composed image that take nothing: no PNG of the module, no common image", () => {
    const edited = project("core", { menus: [] });
    const writers = {
      files: [],
      composed: [
        // Another module's image and the module's own composed image are no layer.
        { name: "window", refs: ["frame", "anvil", "kit:panel", "artisan:ribbon", "kit:ghost"] },
        { name: "card", refs: ["frame", "frame"] },
        { name: "badge", refs: ["window", "window"] },
      ],
      png: (name: string) => name === "frame",
    };
    expect(checkImageIssues(edited, holders(), writers)).toEqual([
      { kind: "layer_missing", image: "badge", refs: ["window"] },
      { kind: "layer_missing", image: "window", refs: ["anvil", "kit:ghost"] },
    ]);
  });

  it("a layer's tint that is no colour and no name of the palette is reported, once the palette is known", () => {
    const edited = project("core", { menus: [] });
    const writers = {
      files: [],
      composed: [
        { name: "badge", refs: ["frame"], tints: ["primary", "#C03366", "gold"] },
        { name: "plate", refs: ["frame"], tints: ["nowhere", "#fff", "nowhere"] },
        { name: "plain", refs: ["frame"] },
      ],
      png: () => true,
    };
    expect(checkImageIssues(edited, holders(), writers)).toEqual([]);
    const palette = paletteOf(['gold: "#d4a017"\n']);
    expect(checkImageIssues(edited, holders(), writers, palette)).toEqual([
      { kind: "tint_unknown", image: "plate", tints: ["nowhere", "#fff"] },
    ]);
  });
});

describe("serverChecksFor — images", () => {
  const edited = project("core", { menus: [drawn("main", ["ghost"])] });

  it("checks the images when it is told who holds them", () => {
    const ready = { status: "ready" as const, projects: [], failed: [] };
    expect(serverChecksFor(edited, ready).issues).toEqual([]);
    expect(serverChecksFor(edited, ready, null).issues).toEqual([]);
    expect(serverChecksFor(edited, ready, holders()).issues).toEqual([
      { kind: "image_missing", ref: "ghost", menus: ["main"] },
    ]);
  });

  it("does not when a module could not be read: its images may answer the name", () => {
    const checks = serverChecksFor(
      edited,
      { status: "ready", projects: [], failed: ["jobs"] },
      holders(),
    );
    expect(checks.issues).toEqual([]);
    expect(checks.unreadable).toEqual(["jobs"]);
  });
});
