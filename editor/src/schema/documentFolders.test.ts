import { registerDocumentKind, resetDocumentKinds } from "@/domain/documentKinds";
import { dialogsOf, documentsOf, menusOf } from "@/domain/documents";
import type { Document, ProjectId } from "@/domain/types";
import { afterEach, describe, expect, it } from "vitest";
import { registerDocumentCodec, resetDocumentCodecs } from "./documentCodecs";
import { adoptLateDocuments, projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

/** Themed folders inside a module (`domain/documentLayout.ts`): read, written back, never lost. */
afterEach(() => {
  resetDocumentKinds();
  resetDocumentCodecs();
});

const PID = "survie" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;
const MENU = "schema: menu/v1\ntitle: Shop\nrows: 1\n";
const DIALOG = "schema: dialog/v1\ntitle: Hi\n";

describe("themed folders", () => {
  it("reads Documents of any kind from themed folders and writes them back in place", () => {
    const project = projectFromFiles(PID, {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/menus/main.yaml`]: MENU,
      [`${base}/boutique/menus/shop.yaml`]: MENU,
      [`${base}/boutique/armes/menus/swords.yaml`]: MENU,
      [`${base}/boutique/dialogs/welcome.yaml`]: DIALOG,
    });

    expect(menusOf(project).map((m) => [m.id, m.folder])).toEqual([
      ["main", undefined],
      ["shop", "boutique"],
      ["swords", "boutique/armes"],
    ]);
    expect(dialogsOf(project).map((d) => [d.id, d.folder])).toEqual([["welcome", "boutique"]]);
    expect(project.moduleData).toBeUndefined();

    const files = projectToFiles(project);
    const docFiles = Object.keys(files).filter((k) => /\/(menus|dialogs)\//.test(k));
    expect(docFiles.sort()).toEqual([
      `${base}/boutique/armes/menus/swords.yaml`,
      `${base}/boutique/dialogs/welcome.yaml`,
      `${base}/boutique/menus/shop.yaml`,
      `${base}/menus/main.yaml`,
    ]);
    expect(files[`${base}/boutique/menus/shop.yaml`]).not.toContain("folder");
  });

  it("moves a Document by changing its folder only", () => {
    const project = projectFromFiles(PID, {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/menus/shop.yaml`]: MENU,
    });
    const before = projectToFiles(project)[`${base}/menus/shop.yaml`];
    menusOf(project)[0]!.folder = "boutique";
    const files = projectToFiles(project);
    expect(files[`${base}/menus/shop.yaml`]).toBeUndefined();
    expect(files[`${base}/boutique/menus/shop.yaml`]).toBe(before);
  });

  it("keeps refused files verbatim instead of dropping them on save", () => {
    const tree = {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/menus/shop.yaml`]: MENU,
      [`${base}/boutique/menus/shop.yaml`]: "schema: menu/v1\ntitle: Other\nrows: 2\n",
      [`${base}/menus/old/legacy.yaml`]: MENU,
    };
    const project = projectFromFiles(PID, tree);

    expect(menusOf(project)).toEqual([]);
    expect(Object.keys(project.unreadFiles ?? {}).sort()).toEqual([
      "boutique/menus/shop.yaml",
      "menus/old/legacy.yaml",
      "menus/shop.yaml",
    ]);
    const files = projectToFiles(project);
    for (const path of Object.keys(tree).filter((k) => !k.endsWith("manifest.yaml"))) {
      expect(files[path]).toBe(tree[path]);
    }
  });

  it("adopts a late kind's Documents from themed folders, folder kept", () => {
    const project = projectFromFiles(PID, {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/quetes/notes/daily.yaml`]: "schema: note/v1\ntext: hi\n",
      [`${base}/quetes/readme.yaml`]: "x: 1\n",
    });
    expect(project.moduleData).toEqual({
      quetes: {
        __files: { "notes/daily.yaml": "schema: note/v1\ntext: hi\n", "readme.yaml": "x: 1\n" },
      },
    });

    registerDocumentKind({ kind: "note", dir: "notes", schemaVersion: "note/v1", rank: 9 });
    registerDocumentCodec({
      kind: "note",
      parse: (src) => ({
        doc: { id: src.id, text: src.text } as unknown as Document,
        i18nKeys: {},
        unsupported: [],
      }),
      serialize: (doc) => ({
        schema: "note/v1",
        id: doc.id,
        text: (doc as unknown as { text: string }).text,
      }),
    });

    expect(adoptLateDocuments(project)).toBe(1);
    expect(documentsOf(project, "note")).toEqual([{ id: "daily", text: "hi", folder: "quetes" }]);
    expect(project.moduleData).toEqual({ quetes: { __files: { "readme.yaml": "x: 1\n" } } });
    expect(projectToFiles(project)[`${base}/quetes/notes/daily.yaml`]).toBe(
      "schema: note/v1\ntext: hi\n",
    );
  });
});
