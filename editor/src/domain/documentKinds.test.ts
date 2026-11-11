import { afterEach, describe, expect, it } from "vitest";
import {
  COMMAND_KIND,
  DIALOG_KIND,
  MENU_KIND,
  documentKindByDir,
  documentKindDef,
  isDocumentKind,
  listDocumentKinds,
  registerDocumentKind,
  resetDocumentKinds,
} from "./documentKinds";
import {
  allDocuments,
  documentIds,
  documentsOf,
  emptyDocuments,
  findDocument,
  menusOf,
  mutableDocuments,
  mutableMenus,
} from "./documents";
import type { Menu, Project } from "./types";

/**
 * ADR `extensible-document-kinds`, decisions 1 and 10: the kinds a project holds
 * are a registry, and `Project.documents[kind]` is the one store the typed
 * accessors read.
 */
afterEach(resetDocumentKinds);

const menu = (id: string) => ({ id, rows: 3, layers: [], title: [] }) as unknown as Menu;

describe("document kind registry", () => {
  it("ships the three core kinds in registration order", () => {
    expect(listDocumentKinds()).toEqual([MENU_KIND, COMMAND_KIND, DIALOG_KIND]);
    expect(documentKindByDir("menus")).toBe(MENU_KIND);
    expect(documentKindByDir("quests")).toBeUndefined();
    expect(isDocumentKind("dialog")).toBe(true);
    expect(() => documentKindDef("quest")).toThrow(/unknown document kind/);
  });

  it("accepts a module's kind and refuses a duplicate id, folder or id prefix", () => {
    const quest = {
      kind: "quest",
      dir: "quests",
      idPrefix: "q_",
      schemaVersion: "quest/v1",
      rank: 9,
    };
    registerDocumentKind(quest);
    expect(listDocumentKinds().at(-1)).toEqual(quest);
    expect(() => registerDocumentKind({ ...quest, dir: "other", idPrefix: "x_" })).toThrow(
      /duplicate/,
    );
    expect(() => registerDocumentKind({ ...quest, kind: "other", idPrefix: "x_" })).toThrow(
      /folder/,
    );
    expect(() => registerDocumentKind({ ...quest, kind: "other", dir: "other" })).toThrow(/prefix/);
  });
});

describe("documents façade", () => {
  it("reads the container, typed for the core kinds, and tolerates a missing project", () => {
    const project = { documents: { menu: [menu("m1")], quest: [{ id: "q1" } as never] } } as Pick<
      Project,
      "documents"
    >;
    expect(menusOf(project).map((m) => m.id)).toEqual(["m1"]);
    expect(documentsOf(project, "quest").map((d) => d.id)).toEqual(["q1"]);
    expect(documentsOf(project, "dialog")).toEqual([]);
    expect(menusOf(undefined)).toEqual([]);
    expect(allDocuments(project).map((d) => `${d.kind}:${d.doc.id}`)).toEqual([
      "menu:m1",
      "quest:q1",
    ]);
    expect(documentIds(project)).toEqual(["m1", "q1"]);
    expect(findDocument(project, "q1")?.kind).toBe("quest");
  });

  it("creates a kind's list on first write and never on read", () => {
    const project = { documents: {} } as Pick<Project, "documents">;
    menusOf(project);
    expect(project.documents).toEqual({});
    mutableMenus(project).push(menu("m1"));
    mutableDocuments(project, "quest").push({ id: "q1" } as never);
    expect(Object.keys(project.documents)).toEqual(["menu", "quest"]);
    expect(Object.keys(emptyDocuments())).toEqual(["menu", "command", "dialog"]);
  });
});
