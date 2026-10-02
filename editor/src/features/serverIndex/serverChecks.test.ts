import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { checkServerIssues, serverChecksFor } from "./serverChecks";

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
                        ? { type: "open_dialog", dialogId: o.to }
                        : { type: "open_menu", menuId: o.to },
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
    menus: docs.menus ?? [],
    commands: (docs.commands ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      aliases: c.aliases,
      arguments: [],
      steps: c.opens ? [{ kind: "action", action: { type: "open_menu", menuId: c.opens } }] : [],
    })),
    dialogs: (docs.dialogs ?? []).map((d) => ({ id: d, buttons: [] })),
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
