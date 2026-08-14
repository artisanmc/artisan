import { describe, it, expect } from "vitest";
import { projectFromFiles } from "./projectFromFiles";
import { transform } from "@/features/export/transform";
import { parse } from "yaml";
import type { ProjectId } from "@/domain/types";

const BASE = "plugins/Artisan/projects/p1";

function load(files: Record<string, string>) {
  return projectFromFiles("p1" as ProjectId, files, { diskId: "p1" });
}

/**
 * Le nom de fichier est l'identité d'un Document — miroir du `withFileId` du
 * plugin. Le champ `id:` interne était une seconde source pour la même vérité.
 */
describe("l'identité d'un Document vient de son nom de fichier", () => {
  it("charge un menu sans champ id", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nsize: 27\n",
    });
    expect(project.menus.map((m) => m.id)).toEqual(["accueil"]);
  });

  it("ignore un id interne divergent au profit du fichier", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nid: vieux_nom\nsize: 27\n",
    });
    expect(project.menus.map((m) => m.id)).toEqual(["accueil"]);
  });

  it("n'écrit plus le champ id dans le fichier", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nsize: 27\n",
    });
    const out = transform(project);
    const doc = parse(out[`${BASE}/menus/accueil.yaml`]!) as Record<string, unknown>;
    expect(doc.schema).toBe("menu/v1");
    // Le fichier porte déjà son identité dans son nom : la répéter dedans, c'est
    // rouvrir la porte à la divergence.
    expect("id" in doc).toBe(false);
  });

  it("le round-trip conserve l'identité", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nsize: 27\n",
    });
    const reloaded = load(transform(project));
    expect(reloaded.menus.map((m) => m.id)).toEqual(["accueil"]);
  });
});
