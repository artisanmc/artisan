import { describe, it, expect } from "vitest";
import { projectFromFiles } from "./projectFromFiles";
import { transform } from "@/features/export/transform";
import { parse } from "yaml";
import type { ProjectId } from "@/domain/types";
import { menusOf } from "@/domain/documents";

const BASE = "plugins/Artisan/projects/p1";

function load(files: Record<string, string>) {
  return projectFromFiles("p1" as ProjectId, files, { diskId: "p1" });
}

/**
 * The file name is a Document's identity — mirror of the plugin's
 * `withFileId`. The inner `id:` field was a second source for the same truth.
 */
describe("a Document's identity comes from its file name", () => {
  it("loads a menu without an id field", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nsize: 27\n",
    });
    expect(menusOf(project).map((m) => m.id)).toEqual(["accueil"]);
  });

  it("ignores a diverging internal id in favour of the file", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nid: vieux_nom\nsize: 27\n",
    });
    expect(menusOf(project).map((m) => m.id)).toEqual(["accueil"]);
  });

  it("no longer writes the id field into the file", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nsize: 27\n",
    });
    const out = transform(project);
    const doc = parse(out[`${BASE}/menus/accueil.yaml`]!) as Record<string, unknown>;
    expect(doc.schema).toBe("menu/v1");
    // The file already carries its identity in its name: repeating it inside
    // reopens the door to divergence.
    expect("id" in doc).toBe(false);
  });

  it("the round trip keeps the identity", () => {
    const project = load({
      [`${BASE}/manifest.yaml`]: "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n",
      [`${BASE}/menus/accueil.yaml`]: "schema: menu/v1\nsize: 27\n",
    });
    const reloaded = load(transform(project));
    expect(menusOf(reloaded).map((m) => m.id)).toEqual(["accueil"]);
  });
});
