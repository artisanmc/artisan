import { describe, expect, test } from "bun:test";
import { importProjectFromFiles, readEditorEdgesFromFiles, readEditorLayoutFromFiles, readOwnerModuleFromFiles } from "./projectImport";

const PACK_ID = "p_layout";
const base = `plugins/Artisan/projects/${PACK_ID}`;

function manifestWith(editorLayout: string | null): Record<string, string> {
  const body = [
    "schema: manifest/v1",
    `project_id: ${PACK_ID}`,
    "default_lang: en",
    "files:",
    "  menus: [shop]",
    "  commands: []",
    "  dialogs: []",
    ...(editorLayout ? [editorLayout] : []),
  ].join("\n");
  return {
    [`${base}/manifest.yaml`]: body,
    [`${base}/menus/shop.yaml`]: "id: shop\nsize: 27\n",
  };
}

describe("readEditorLayoutFromFiles", () => {
  test("parses editor_layout from manifest", () => {
    const files = manifestWith("editor_layout:\n  shop: { x: 40, y: 80 }\n");
    expect(readEditorLayoutFromFiles(files, PACK_ID)).toEqual({
      shop: { x: 40, y: 80 },
    });
  });

  test("missing editor_layout → {}", () => {
    const files = manifestWith(null);
    expect(readEditorLayoutFromFiles(files, PACK_ID)).toEqual({});
  });

  test("malformed entries silently ignored (non-numeric x/y, null value)", () => {
    const files = manifestWith(
      [
        "editor_layout:",
        "  shop:    { x: 40, y: 80 }",
        "  bad_xy:  { x: \"oops\", y: 5 }",
        "  bad_inf: { x: .inf, y: 1 }",
        "  null_v:  null",
      ].join("\n"),
    );
    expect(readEditorLayoutFromFiles(files, PACK_ID)).toEqual({
      shop: { x: 40, y: 80 },
    });
  });

  test("missing manifest.yaml → {}", () => {
    expect(readEditorLayoutFromFiles({}, PACK_ID)).toEqual({});
  });
});

describe("importProjectFromFiles — canvasLayout", () => {
  test("populates canvasLayout from manifest.editor_layout", () => {
    const files = manifestWith("editor_layout:\n  shop: { x: 12, y: 34 }\n");
    const project = importProjectFromFiles(PACK_ID, files) as { canvasLayout: Record<string, { x: number; y: number }> };
    expect(project.canvasLayout).toEqual({ shop: { x: 12, y: 34 } });
  });

  test("no editor_layout → canvasLayout: {}", () => {
    const project = importProjectFromFiles(PACK_ID, manifestWith(null)) as { canvasLayout: Record<string, unknown> };
    expect(project.canvasLayout).toEqual({});
  });
});

describe("importProjectFromFiles — ownerModule (Add-on-owned project)", () => {
  test("manifest `module:` → project.ownerModule", () => {
    const files = {
      [`${base}/manifest.yaml`]: [
        "schema: manifest/v1",
        `project_id: ${PACK_ID}`,
        "module: boutique",
        "default_lang: en",
        "files: { menus: [shop], commands: [], dialogs: [] }",
      ].join("\n"),
      [`${base}/menus/shop.yaml`]: "id: shop\nsize: 27\n",
    };
    const project = importProjectFromFiles(PACK_ID, files) as { ownerModule?: string };
    expect(project.ownerModule).toBe("boutique");
  });

  test("no `module:` → ownerModule undefined", () => {
    const project = importProjectFromFiles(PACK_ID, manifestWith(null)) as { ownerModule?: string };
    expect(project.ownerModule).toBeUndefined();
  });

  test("readOwnerModuleFromFiles reads manifest.module", () => {
    const files = {
      [`${base}/manifest.yaml`]: `schema: manifest/v1\nproject_id: ${PACK_ID}\nmodule: boutique\n`,
    };
    expect(readOwnerModuleFromFiles(files, PACK_ID)).toBe("boutique");
    expect(readOwnerModuleFromFiles(manifestWith(null), PACK_ID)).toBeUndefined();
  });
});

describe("round-trip mirror — backend parses what the editor emits", () => {
  test("manifest with the editor's block-style shape yields matching canvasLayout", () => {
    // Mirror of editor/src/features/export/transform.test.ts:
    // "emits editor_layout in block-style YAML the backend round-trip test parses"
    const files = {
      "plugins/Artisan/projects/p_mirror/manifest.yaml": [
        "schema: manifest/v1",
        "project_id: p_mirror",
        "default_lang: en",
        "languages:",
        "  - en",
        "files:",
        "  menus:",
        "    - shop",
        "  commands: []",
        "  dialogs: []",
        "editor_layout:",
        "  shop:",
        "    x: 123",
        "    y: 456",
      ].join("\n") + "\n",
      "plugins/Artisan/projects/p_mirror/menus/shop.yaml": "id: shop\nsize: 27\n",
    };
    const project = importProjectFromFiles("p_mirror", files) as {
      canvasLayout: Record<string, { x: number; y: number }>;
    };
    expect(project.canvasLayout).toEqual({ shop: { x: 123, y: 456 } });
  });
});

describe("readEditorEdgesFromFiles", () => {
  test("parses editor_edges from manifest", () => {
    const files = manifestWith(
      "editor_edges:\n  'shop->confirm': { from: { side: right, t: 0.25 }, to: { side: left, t: 0.5 } }\n",
    );
    expect(readEditorEdgesFromFiles(files, PACK_ID)).toEqual({
      "shop->confirm": { from: { side: "right", t: 0.25 }, to: { side: "left", t: 0.5 } },
    });
  });

  test("missing editor_edges → {}", () => {
    const files = manifestWith(null);
    expect(readEditorEdgesFromFiles(files, PACK_ID)).toEqual({});
  });

  test("drops malformed entries (bad side, non-numeric t, empty anchors)", () => {
    const files = manifestWith(
      [
        "editor_edges:",
        "  'a->b': { from: { side: diagonal, t: 0.5 } }",
        "  'c->d': { from: { side: top, t: oops } }",
        "  'e->f': {}",
        "  'g->h': { to: { side: bottom, t: 0.9 } }",
      ].join("\n") + "\n",
    );
    expect(readEditorEdgesFromFiles(files, PACK_ID)).toEqual({
      "g->h": { to: { side: "bottom", t: 0.9 } },
    });
  });
});

describe("importProjectFromFiles — captured items (items/*.yml)", () => {
  const stackYaml = [
    "item:",
    "  ==: org.bukkit.inventory.ItemStack",
    "  DataVersion: 4671",
    "  id: minecraft:paper",
    "  count: 5",
    "  components:",
    "    minecraft:custom_model_data: '{floats:[26603.0f]}'",
    `    minecraft:custom_data: '{PublicBukkitValues:{"nexo:id":"arcanist_key"}}'`,
    `    minecraft:item_name: '{color:"white",text:"Clé Luxury"}'`,
    "  schema_version: 1",
    "display:",
    "  enchanted: true",
    "  name: 1 clé Luxury",
    "",
  ].join("\n");

  test("maps items/*.yml to editor capturedItems with a derived display", () => {
    const files = {
      ...manifestWith(null),
      [`${base}/items/ci_key.yml`]: stackYaml,
    };
    const project = importProjectFromFiles(PACK_ID, files) as {
      capturedItems?: { id: string; name: string; stackYaml: string; display: Record<string, unknown> }[];
      moduleData?: Record<string, unknown>;
    };
    expect(project.capturedItems).toHaveLength(1);
    const ci = project.capturedItems![0]!;
    expect(ci.id).toBe("ci_key");
    expect(ci.stackYaml).toBe(stackYaml); // verbatim — the runtime truth
    // Derived from the stack: nexo custom ref wins over the vanilla id; count kept.
    expect(ci.display.material).toBe("nexo:arcanist_key");
    expect(ci.display.count).toBe(5);
    // `display:` overrides in the file win over derivation.
    expect(ci.display.enchanted).toBe(true);
    expect(ci.display.name).toBe("1 clé Luxury");
    expect(ci.name).toBe("1 clé Luxury");
    // items/ is core — must NOT leak into moduleData.
    expect(project.moduleData).toBeUndefined();
  });

  test("plain vanilla stack derives the material from the id", () => {
    const files = {
      ...manifestWith(null),
      [`${base}/items/ci_sword.yml`]: [
        "item:",
        "  ==: org.bukkit.inventory.ItemStack",
        "  id: minecraft:diamond_sword",
        "  count: 1",
        "",
      ].join("\n"),
    };
    const project = importProjectFromFiles(PACK_ID, files) as {
      capturedItems?: { id: string; display: Record<string, unknown> }[];
    };
    expect(project.capturedItems![0]!.display).toEqual({ material: "DIAMOND_SWORD" });
  });

  test("unparseable item file is skipped without breaking the import", () => {
    const files = { ...manifestWith(null), [`${base}/items/bad.yml`]: "{{{" };
    const project = importProjectFromFiles(PACK_ID, files) as { capturedItems?: unknown[] };
    expect(project.capturedItems ?? []).toHaveLength(0);
  });
});

describe("importProjectFromFiles — module dirs", () => {
  test("collects unknown top-level dirs into moduleData.__files", () => {
    const files = {
      ...manifestWith(null),
      [`${base}/boutique/shop.yaml`]: "schema: boutique/v1\ncategories: []\n",
      [`${base}/boutique/notes/readme.txt`]: "hi",
    };
    const project = importProjectFromFiles(PACK_ID, files) as {
      moduleData?: Record<string, { __files: Record<string, string> }>;
    };
    expect(project.moduleData?.boutique.__files["shop.yaml"]).toContain("boutique/v1");
    expect(project.moduleData?.boutique.__files["notes/readme.txt"]).toBe("hi");
  });

  test("hostile dir names (__proto__, constructor) are skipped without throwing", () => {
    const files = {
      ...manifestWith(null),
      [`${base}/__proto__/x.yaml`]: "a: 1",
      [`${base}/constructor/y.yaml`]: "b: 2",
      [`${base}/boutique/shop.yaml`]: "schema: boutique/v1\n",
    };
    const project = importProjectFromFiles(PACK_ID, files) as {
      moduleData?: Record<string, { __files: Record<string, string> }>;
    };
    expect(Object.keys(project.moduleData ?? {})).toEqual(["boutique"]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  test("does not create moduleData for core dirs or .artisan files", () => {
    const files = { ...manifestWith(null), [`${base}/.artisan-sync.yaml`]: "x: 1" };
    const project = importProjectFromFiles(PACK_ID, files) as { moduleData?: unknown };
    expect(project.moduleData).toBeUndefined();
  });
});

describe("importProjectFromFiles canvasEdges", () => {
  test("populates canvasEdges from manifest.editor_edges", () => {
    const files = manifestWith("editor_edges:\n  'shop->x': { from: { side: top, t: 0.1 } }\n");
    const project = importProjectFromFiles(PACK_ID, files);
    expect(project.canvasEdges).toEqual({ "shop->x": { from: { side: "top", t: 0.1 } } });
  });

  test("no editor_edges → canvasEdges: {}", () => {
    const project = importProjectFromFiles(PACK_ID, manifestWith(null));
    expect(project.canvasEdges).toEqual({});
  });
});
