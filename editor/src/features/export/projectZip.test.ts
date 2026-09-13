import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildZip } from "./buildZip";
import { normalizeProjectFiles, readProjectZip } from "./projectZip";

const MANIFEST = "schema: manifest/v1\nproject_id: shop\ndefault_lang: en\nlanguages: [en]\n";
const MENU = 'schema: menu/v1\nid: m\ntitle: "Shop"\nsize: 27\nelements: []\n';

describe("normalizeProjectFiles", () => {
  it("excludes private drafts and operation journals while retaining editor metadata", () => {
    const { files } = normalizeProjectFiles({
      "shop/manifest.yaml": MANIFEST,
      "shop/.artisan/editor.yaml": "board",
      "shop/.artisan/drafts/owner/draft.json": "private",
      "shop/.artisan/transactions/op.json": "private",
      "shop/.artisan/rename-operation.json": "private",
    });
    expect(Object.keys(files)).toEqual([
      "plugins/Artisan/projects/shop/manifest.yaml",
      "plugins/Artisan/projects/shop/.artisan/editor.yaml",
    ]);
  });
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

  it("requires an explicit target for an archive without a project folder", () => {
    expect(() => normalizeProjectFiles({ "manifest.yaml": MANIFEST })).toThrow(
      "project_id_required",
    );
  });
  it("rejects explicit folder names that cannot be used by the server", () => {
    for (const target of ["with space", "a:b", "CON", "com1", "trailing.", "x".repeat(129)]) {
      expect(() => normalizeProjectFiles({ "manifest.yaml": MANIFEST }, target)).toThrow(
        "invalid_project_id",
      );
    }
  });

  it("re-roots a rootless zip using the chosen target", () => {
    const { projectId, files } = normalizeProjectFiles(
      {
        "manifest.yaml": MANIFEST,
        "menus/m.yaml": MENU,
      },
      "shop",
    );
    expect(projectId).toBe("shop");
    expect(files["plugins/Artisan/projects/shop/manifest.yaml"]).toBe(MANIFEST);
  });

  it("uses the folder identity when a legacy manifest declares another id", () => {
    const { projectId, files } = normalizeProjectFiles({
      "renamed_shop/manifest.yaml": MANIFEST,
      "renamed_shop/menus/m.yaml": MENU,
    });
    expect(projectId).toBe("renamed_shop");
    expect(files["plugins/Artisan/projects/renamed_shop/menus/m.yaml"]).toBe(MENU);
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
  it("preserves binary archives without decoding image bytes", async () => {
    const zip = new JSZip();
    zip.file("shop/manifest.yaml", MANIFEST);
    zip.file("shop/assets/icon.png", new Uint8Array([137, 80, 78, 71, 0, 255]));
    expect((await readProjectZip(await zip.generateAsync({ type: "blob" })))["shop/assets/icon.png"]).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
  });
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
