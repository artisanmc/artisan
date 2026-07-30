import { describe, expect, it } from "vitest";
import { buildZip } from "./buildZip";
import { normalizeProjectFiles, readProjectZip } from "./projectZip";

const MANIFEST = "schema: manifest/v1\nproject_id: shop\ndefault_lang: en\nlanguages: [en]\n";
const MENU = 'schema: menu/v1\nid: m\ntitle: "Shop"\nsize: 27\nelements: []\n';

describe("normalizeProjectFiles", () => {
  it("keeps the canonical server layout as-is", () => {
    const { projectId, files } = normalizeProjectFiles({
      "plugins/Artisan/projects/shop/manifest.yaml": MANIFEST,
      "plugins/Artisan/projects/shop/menus/m.yaml": MENU,
    });
    expect(projectId).toBe("shop");
    expect(Object.keys(files).sort()).toEqual([
      "plugins/Artisan/projects/shop/manifest.yaml",
      "plugins/Artisan/projects/shop/menus/m.yaml",
    ]);
  });

  it("re-roots a zip of the project directory itself", () => {
    // What an admin gets by zipping `plugins/Artisan/projects/shop/` on their server.
    const { projectId, files } = normalizeProjectFiles({
      "shop/manifest.yaml": MANIFEST,
      "shop/menus/m.yaml": MENU,
    });
    expect(projectId).toBe("shop");
    expect(files["plugins/Artisan/projects/shop/menus/m.yaml"]).toBe(MENU);
  });

  it("re-roots a zip whose manifest sits at the root", () => {
    const { projectId, files } = normalizeProjectFiles({
      "manifest.yaml": MANIFEST,
      "menus/m.yaml": MENU,
    });
    // No directory to name it — the manifest's own project_id wins.
    expect(projectId).toBe("shop");
    expect(files["plugins/Artisan/projects/shop/manifest.yaml"]).toBe(MANIFEST);
  });

  it("prefers the manifest's project_id over the directory name", () => {
    const { projectId, files } = normalizeProjectFiles({
      "Ma Boutique (copie)/manifest.yaml": MANIFEST,
      "Ma Boutique (copie)/menus/m.yaml": MENU,
    });
    expect(projectId).toBe("shop");
    expect(files["plugins/Artisan/projects/shop/menus/m.yaml"]).toBe(MENU);
  });

  it("falls back to the directory name when the manifest declares no id", () => {
    const { projectId } = normalizeProjectFiles({
      "my_project/manifest.yaml": "schema: manifest/v1\ndefault_lang: en\n",
    });
    expect(projectId).toBe("my_project");
  });

  it("picks the shallowest manifest when an extra folder wraps the export", () => {
    const { projectId, files } = normalizeProjectFiles({
      "export-2026/plugins/Artisan/projects/shop/manifest.yaml": MANIFEST,
      "export-2026/plugins/Artisan/projects/shop/menus/m.yaml": MENU,
    });
    expect(projectId).toBe("shop");
    expect(files["plugins/Artisan/projects/shop/menus/m.yaml"]).toBe(MENU);
  });

  it("carries files the domain does not model — add-on roots stay whole", () => {
    const { files } = normalizeProjectFiles({
      "shop/manifest.yaml": MANIFEST,
      "shop/.artisan/editor.yaml": "schema: editor-state/v1\n",
      "shop/config.yml": "whole-shop-discount: 0\n",
    });
    expect(files["plugins/Artisan/projects/shop/.artisan/editor.yaml"]).toBe(
      "schema: editor-state/v1\n",
    );
    expect(files["plugins/Artisan/projects/shop/config.yml"]).toBe("whole-shop-discount: 0\n");
  });

  it("rejects an archive with no manifest", () => {
    expect(() => normalizeProjectFiles({ "readme.txt": "hello" })).toThrow("no_manifest");
  });

  it("ignores macOS resource forks and directory entries", () => {
    const { files } = normalizeProjectFiles({
      "__MACOSX/._manifest.yaml": "junk",
      "shop/manifest.yaml": MANIFEST,
      "shop/menus/": "",
    });
    expect(Object.keys(files).sort()).toEqual(["plugins/Artisan/projects/shop/manifest.yaml"]);
  });
});

describe("readProjectZip", () => {
  it("round-trips a zip built by the exporter", async () => {
    const blob = await buildZip({
      "plugins/Artisan/projects/shop/manifest.yaml": MANIFEST,
      "plugins/Artisan/projects/shop/menus/m.yaml": MENU,
    });
    const entries = await readProjectZip(blob);
    expect(entries["plugins/Artisan/projects/shop/menus/m.yaml"]).toBe(MENU);
  });

  it("rejects a file that is not a zip", async () => {
    const blob = new Blob(['{"name":"legacy json export"}'], { type: "application/json" });
    await expect(readProjectZip(blob)).rejects.toThrow("not_a_zip");
  });
});
