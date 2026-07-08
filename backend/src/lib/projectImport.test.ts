import { describe, expect, test } from "bun:test";
import { importProjectFromFiles, readEditorEdgesFromFiles, readEditorLayoutFromFiles } from "./projectImport";

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
