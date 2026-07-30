import { describe, expect, it, vi } from "vitest";
import { buildZip } from "./buildZip";
import { runImportZip } from "./runImportZip";

const MANIFEST =
  "schema: manifest/v1\nproject_id: shop\ndefault_lang: en\nlanguages: [en]\nfiles:\n  menus: [m]\n  commands: []\n";
const MENU = 'schema: menu/v1\nid: m\ntitle: "Shop"\nsize: 27\nelements: []\n';

type ImportFn = (input: { pack: unknown }) => string;

/** The Project handed to the store on the first (and only) import call. */
function firstPack(fn: ReturnType<typeof vi.fn<ImportFn>>): { menus: unknown[] } {
  const call = fn.mock.calls[0];
  if (!call) throw new Error("importProject was never called");
  return call[0].pack as { menus: unknown[] };
}

describe("runImportZip", () => {
  it("parses a server-shaped zip into a Project and hands it to the store", async () => {
    const blob = await buildZip({
      "plugins/Artisan/projects/shop/manifest.yaml": MANIFEST,
      "plugins/Artisan/projects/shop/menus/m.yaml": MENU,
    });
    const importProject = vi.fn(() => "p_new");

    const res = await runImportZip(blob, importProject);

    expect(res.newId).toBe("p_new");
    expect(importProject).toHaveBeenCalledTimes(1);
    const pack = firstPack(importProject);
    expect(pack.menus).toHaveLength(1);
  });

  it("accepts a project directory zipped straight off the server", async () => {
    const blob = await buildZip({
      "shop/manifest.yaml": MANIFEST,
      "shop/menus/m.yaml": MENU,
    });
    const importProject = vi.fn(() => "p_new");

    await runImportZip(blob, importProject);

    const pack = firstPack(importProject);
    expect(pack.menus).toHaveLength(1);
  });

  it("reports a legacy JSON export as not_a_zip rather than failing obscurely", async () => {
    const blob = new Blob(['{"name":"legacy"}'], { type: "application/json" });
    await expect(
      runImportZip(
        blob,
        vi.fn(() => "x"),
      ),
    ).rejects.toThrow("not_a_zip");
  });

  it("reports an archive without a manifest", async () => {
    const blob = await buildZip({ "notes.txt": "hello" });
    await expect(
      runImportZip(
        blob,
        vi.fn(() => "x"),
      ),
    ).rejects.toThrow("no_manifest");
  });
});
