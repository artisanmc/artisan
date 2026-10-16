import { menusOf } from "@/domain/documents";
import type { DataSource, Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { applySourceYaml, sourceYamlFiles } from "./sourceYaml";

const PID = "p_yaml" as ProjectId;

function project(): Project {
  return {
    id: PID,
    name: "P",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [],
      commands: [],
      dialogs: [],
      assets: [],
    },
    i18nKeys: {},
    defaultLang: "fr",
    languages: ["fr"],
    canvasLayout: {},
    dataModels: [
      {
        id: "mdl_ranks" as never,
        name: "rank",
        keyField: "id",
        fields: [
          { name: "id", type: { kind: "string" } },
          { name: "price", type: { kind: "integer" }, help: "Prix en jetons." },
        ],
      },
    ],
    dataSources: [
      {
        id: "ranks" as never,
        name: "ranks",
        shape: "table",
        modelId: "mdl_ranks" as never,
        rows: [{ id: "vip", price: 10 }],
      },
      {
        id: "settings" as never,
        name: "settings",
        shape: "config",
        fields: [],
        value: { motd: "salut" },
      },
    ],
  } as unknown as Project;
}

const source = (p: Project, id: string) =>
  p.dataSources.find((d) => String(d.id) === id) as DataSource;

describe("sourceYamlFiles", () => {
  it("renders only the files of the requested source", () => {
    const p = project();
    const files = sourceYamlFiles(p, source(p, "ranks"));
    expect(files.map((f) => f.path)).toContain("data/ranks.yaml");
    expect(files.every((f) => f.path.includes("ranks"))).toBe(true);
  });

  it("includes the beside schema of a project-authored source", () => {
    const p = project();
    const paths = sourceYamlFiles(p, source(p, "ranks")).map((f) => f.path);
    expect(paths).toContain("models/ranks.yaml");
  });

  it("shows the content the writer would write", () => {
    const p = project();
    const data = sourceYamlFiles(p, source(p, "ranks")).find((f) => f.path === "data/ranks.yaml")!;
    expect(data.content).toContain("vip");
    // Single-file table = list of rows: the schema's help texts are NOT repeated
    // on every row (they are for object and per-row files, cf. transformBare.test).
    expect(data.content).not.toContain("Prix en jetons.");
  });
});

describe("applySourceYaml", () => {
  it("re-injects a value edited by hand", () => {
    const p = project();
    const files = sourceYamlFiles(p, source(p, "settings"));
    const edited = files.map((f) =>
      f.path === "data/settings.yaml" ? { ...f, content: 'motd: "bonjour"\n' } : f,
    );
    const next = applySourceYaml(p, edited)!;
    const s = next.dataSources.find((d) => String(d.id) === "settings")!;
    if (s.shape !== "config") throw new Error("config attendu");
    expect(s.value.motd).toBe("bonjour");
  });

  // A source edit must not turn into a rewrite of the project.
  it("touches neither the menus nor the layout", () => {
    const p = project();
    p.documents.menu = [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as never];
    p.canvasLayout = { m1: { x: 42, y: 7 } } as never;
    const next = applySourceYaml(p, sourceYamlFiles(p, source(p, "settings")))!;
    expect(menusOf(next)).toBe(menusOf(p));
    expect(next.canvasLayout).toEqual({ m1: { x: 42, y: 7 } });
  });

  it("is a fixed point when nothing is edited", () => {
    const p = project();
    const next = applySourceYaml(p, sourceYamlFiles(p, source(p, "ranks")))!;
    expect(next.dataSources.map((d) => String(d.id)).sort()).toEqual(["ranks", "settings"]);
    const ranks = next.dataSources.find((d) => String(d.id) === "ranks")!;
    if (ranks.shape !== "table") throw new Error("table attendue");
    expect(ranks.rows).toEqual([{ id: "vip", price: 10 }]);
  });
});
