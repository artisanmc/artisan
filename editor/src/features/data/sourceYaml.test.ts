import { describe, expect, it } from "vitest";
import type { DataSource, Project, ProjectId } from "@/domain/types";
import { applySourceYaml, sourceYamlFiles } from "./sourceYaml";

const PID = "p_yaml" as ProjectId;

function project(): Project {
  return {
    id: PID,
    name: "P",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [], commands: [], dialogs: [], assets: [],
    i18nKeys: {}, defaultLang: "fr", languages: ["fr"], canvasLayout: {},
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
      { id: "ranks" as never, name: "ranks", shape: "table", modelId: "mdl_ranks" as never,
        rows: [{ id: "vip", price: 10 }] },
      { id: "settings" as never, name: "settings", shape: "config", fields: [], value: { motd: "salut" } },
    ],
  } as unknown as Project;
}

const source = (p: Project, id: string) => p.dataSources.find((d) => String(d.id) === id) as DataSource;

describe("sourceYamlFiles", () => {
  it("ne rend que les fichiers de la source demandée", () => {
    const p = project();
    const files = sourceYamlFiles(p, source(p, "ranks"));
    expect(files.map((f) => f.path)).toContain("data/ranks.yaml");
    expect(files.every((f) => f.path.includes("ranks"))).toBe(true);
  });

  it("inclut le schéma beside d'une source project-authored", () => {
    const p = project();
    const paths = sourceYamlFiles(p, source(p, "ranks")).map((f) => f.path);
    expect(paths).toContain("models/ranks.yaml");
  });

  it("montre le contenu que le writer écrirait", () => {
    const p = project();
    const data = sourceYamlFiles(p, source(p, "ranks")).find((f) => f.path === "data/ranks.yaml")!;
    expect(data.content).toContain("vip");
    // Table en fichier unique = liste de lignes : les aides du schéma ne sont
    // PAS répétées à chaque ligne (elles le sont pour les fichiers objet et
    // par-row, cf. transformBare.test).
    expect(data.content).not.toContain("Prix en jetons.");
  });
});

describe("applySourceYaml", () => {
  it("réinjecte une valeur éditée à la main", () => {
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

  // Une édition de source ne doit pas devenir une réécriture du project.
  it("ne touche ni aux menus ni à la mise en page", () => {
    const p = project();
    p.menus = [{ id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as never];
    p.canvasLayout = { m1: { x: 42, y: 7 } } as never;
    const next = applySourceYaml(p, sourceYamlFiles(p, source(p, "settings")))!;
    expect(next.menus).toBe(p.menus);
    expect(next.canvasLayout).toEqual({ m1: { x: 42, y: 7 } });
  });

  it("est un point fixe quand rien n'est édité", () => {
    const p = project();
    const next = applySourceYaml(p, sourceYamlFiles(p, source(p, "ranks")))!;
    expect(next.dataSources.map((d) => String(d.id)).sort()).toEqual(["ranks", "settings"]);
    const ranks = next.dataSources.find((d) => String(d.id) === "ranks")!;
    if (ranks.shape !== "table") throw new Error("table attendue");
    expect(ranks.rows).toEqual([{ id: "vip", price: 10 }]);
  });
});
