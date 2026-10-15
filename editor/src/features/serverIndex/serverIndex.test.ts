import type { Project, ProjectId } from "@/domain/types";
import { searchQuery } from "@/features/search/searchIndex";
import { describe, expect, it } from "vitest";
import { indexProjectDocuments, toSearchEntries } from "./serverIndex";

function project(
  id: string,
  docs: {
    menus?: { id: string; title?: string }[];
    commands?: { id: string; name: string }[];
    dialogs?: { id: string; title?: string }[];
  },
  extra: Partial<Project> = {},
): Project {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const text = (key: string, value?: string) => {
    if (value === undefined) return undefined;
    i18nKeys[key] = { en: value };
    return { key };
  };
  return {
    id: id as ProjectId,
    name: id.toUpperCase(),
    defaultLang: "en",
    documents: {
      menu: (docs.menus ?? []).map((m) => {
        const title = text(`t_${m.id}`, m.title);
        return {
          id: m.id,
          projectId: id,
          rows: 3,
          layers: [],
          title: title ? [{ kind: "plain", value: title }] : [],
        };
      }),
      command: (docs.commands ?? []).map((c) => ({
        id: c.id,
        projectId: id,
        name: c.name,
        arguments: [],
        steps: [],
      })),
      dialog: (docs.dialogs ?? []).map((d) => ({
        id: d.id,
        projectId: id,
        title: text(`d_${d.id}`, d.title) ?? { key: `d_${d.id}` },
        buttons: [],
        body: [],
        inputs: [],
      })),
    },
    i18nKeys,
    ...extra,
  } as unknown as Project;
}

describe("indexProjectDocuments", () => {
  it("indexes menus, commands and dialogs under a qualified ref", () => {
    const docs = indexProjectDocuments(
      project("core", {
        menus: [{ id: "accueil", title: "Bienvenue" }, { id: "vide" }],
        commands: [{ id: "cmd_menu", name: "menu" }],
        dialogs: [{ id: "regles", title: "Règles" }],
      }),
      "en",
    );
    expect(docs.map((d) => [d.kind, d.ref, d.label])).toEqual([
      ["menu", "core:accueil", "Bienvenue"],
      ["menu", "core:vide", "vide"],
      ["command", "core:cmd_menu", "/menu"],
      ["dialog", "core:regles", "Règles"],
    ]);
  });

  it("uses the on-disk folder as the namespace when it differs from the internal id", () => {
    const docs = indexProjectDocuments(
      project("internal-9f", { menus: [{ id: "shop" }] }, { diskId: "boutique" }),
      "en",
    );
    expect(docs[0]).toMatchObject({
      namespace: "boutique",
      ref: "boutique:shop",
      urlId: "boutique",
    });
  });

  it("keeps the same id in two projects apart", () => {
    const a = indexProjectDocuments(project("core", { menus: [{ id: "main" }] }), "en");
    const b = indexProjectDocuments(project("boutique", { menus: [{ id: "main" }] }), "en");
    expect([...a, ...b].map((d) => d.ref)).toEqual(["core:main", "boutique:main"]);
  });

  it("carries the project name so a result can say where it lives", () => {
    const [doc] = indexProjectDocuments(project("core", { menus: [{ id: "x" }] }), "en");
    expect(doc?.projectName).toBe("CORE");
  });
});

describe("toSearchEntries", () => {
  const entries = toSearchEntries([
    ...indexProjectDocuments(project("core", { menus: [{ id: "main", title: "Accueil" }] }), "en"),
    ...indexProjectDocuments(
      project("boutique", { menus: [{ id: "main", title: "Catalogue" }] }),
      "en",
    ),
  ]);

  it("gives every entry a distinct id even when doc ids collide across projects", () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });

  it("targets the owning project, not the one being edited", () => {
    const catalogue = entries.find((e) => e.label === "Catalogue");
    expect(catalogue?.target).toEqual({ openId: "main", projectUrlId: "boutique" });
    expect(catalogue?.group).toBe("menu");
    expect(catalogue?.context).toEqual({ key: "search.ctxInProject", owner: "BOUTIQUE" });
  });

  it("is found by the project's name, and a label match ranks first", () => {
    const byProject = searchQuery(entries, "boutique");
    expect(byProject.map((e) => e.label)).toEqual(["Catalogue"]);
    const both = searchQuery(
      toSearchEntries([
        ...indexProjectDocuments(project("shop", { menus: [{ id: "a", title: "Pas lié" }] }), "en"),
        ...indexProjectDocuments(
          project("autre", { menus: [{ id: "shop_menu", title: "shop_menu" }] }),
          "en",
        ),
      ]),
      "shop",
    );
    expect(both.map((e) => e.label)).toEqual(["shop_menu", "Pas lié"]);
  });
});
