// Item templates were a PROJECT-level shared view (`templates/<id>.yaml`) that
// menu elements bound to by ref. They are gone: a set now lives entirely on the
// element that renders it, in the menu it belongs to. This suite locks the
// one-way migration — a legacy tree still on disk imports by INLINING the
// template into every element that referenced it, and never writes `templates/`
// again.
//
// The trap this exists for: two elements sharing one template. Inlining by
// reference would make them share LText nodes, and re-addressing the first
// would strip the translation off the second. Each element must get its own
// clone AND its own duplicated i18n entries.
import type { I18nKey, ProjectId } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { describe, expect, it } from "vitest";
import { projectFromFiles } from "./projectFromFiles";
import { menusOf } from "@/domain/documents";

const PID = "p_mig" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

/** A legacy tree: one template, two elements bound to it (iterates + places). */
function legacyFiles(): Record<string, string> {
  return {
    [`${base}/manifest.yaml`]: [
      "schema: manifest/v1",
      `project_id: ${PID}`,
      "default_lang: en",
      "languages:",
      "  - en",
      "  - fr",
      "files:",
      "  menus:",
      "    - m1",
      "  commands: []",
      "  dialogs: []",
      "  templates:",
      "    - tpl1",
      "",
    ].join("\n"),
    [`${base}/menus/m1.yaml`]: [
      "schema: menu/v1",
      "id: m1",
      "rows: 3",
      "title: Shop",
      "elements:",
      "  - id: a",
      "    positions: 10",
      "    iterates:",
      "      source: items",
      "      template: tpl1",
      "  - id: b",
      "    positions: 20",
      "    places:",
      "      source: items",
      "      template: tpl1",
      "      placements:",
      "        - key: sword",
      "          page: 0",
      "          position: 20",
      "",
    ].join("\n"),
    [`${base}/templates/tpl1.yaml`]: [
      "schema: template/v1",
      "id: tpl1",
      "name: Item tile",
      "source: pack:ds_items",
      "alias: item",
      "key_field: id",
      "appearances:",
      '  - material: "{item.icon}"',
      '    title: "{i18n:item_templates.tpl1.default.title}"',
      "",
    ].join("\n"),
    [`${base}/lang/en.yaml`]: [
      "item_templates:",
      "  tpl1:",
      "    default:",
      "      title: Sword",
      "",
    ].join("\n"),
    [`${base}/lang/fr.yaml`]: [
      "item_templates:",
      "  tpl1:",
      "    default:",
      "      title: Épée",
      "",
    ].join("\n"),
  };
}

const elementsOf = (p: ReturnType<typeof projectFromFiles>) =>
  menusOf(p)[0]!.layers.flatMap((l) => l.elements);

/**
 * The same tree, but with the template rewritten in the current format: FLAT
 * display + `states` (the `appearances` → display switch).
 *
 * This is the shape an up-to-date Add-on writes to disk. The migration reader
 * only knew `appearances:`: it returned an empty list, the element inherited
 * an empty display, and the menu showed without items — without a single
 * message. A perfectly valid file, invisible.
 */
function flatTemplateFiles(): Record<string, string> {
  const files = legacyFiles();
  files[`${base}/templates/tpl1.yaml`] = [
    "schema: template/v1",
    "id: tpl1",
    "alias: item",
    "key_field: id",
    'material: "{item.icon}"',
    'title: "{i18n:item_templates.tpl1.default.title}"',
    "states:",
    "  - material: BARRIER",
    "    if:",
    '      - left: "{item.stock}"',
    '        op: "=="',
    '        right: "0"',
    "",
  ].join("\n");
  return files;
}

describe("templates/ in display + states format", () => {
  it("inlines the flat display, as for an Element", () => {
    const p = projectFromFiles(PID, flatTemplateFiles());
    const [a, b] = elementsOf(p);

    for (const el of [a!, b!]) {
      expect(el.display!.material).toBe("{item.icon}");
      expect(el.states).toHaveLength(1);
      expect(el.states[0]!.material).toBe("BARRIER");
    }
    // alias / key_field stay carried by the binding, as before.
    expect(a!.iterates?.alias).toBe("item");
    expect(b!.places?.keyField).toBe("id");
  });
});

describe("legacy templates/ migration", () => {
  it("inlines the template into every element that referenced it", () => {
    const p = projectFromFiles(PID, legacyFiles());
    const [a, b] = elementsOf(p);

    // The template is gone as an entity — it survives only as element content.
    expect((p as { itemTemplates?: unknown }).itemTemplates ?? []).toEqual([]);

    for (const el of [a!, b!]) {
      expect(el.states).toHaveLength(0);
      expect(el.display!.material).toBe("{item.icon}");
    }
    // alias / key_field lived on the template; they land on the binding.
    expect(a!.iterates?.alias).toBe("item");
    expect(b!.places?.alias).toBe("item");
    expect(b!.places?.keyField).toBe("id");
    // No element still points at a template.
    expect(a!.iterates).not.toHaveProperty("templateId");
    expect(b!.places).not.toHaveProperty("templateId");
  });

  it("gives each element its own key, with every language carried over", () => {
    const p = projectFromFiles(PID, legacyFiles());
    const [a, b] = elementsOf(p);

    const keyA = a!.display!.title!.key;
    const keyB = b!.display!.title!.key;

    // Re-addressed to the element that now owns the text...
    expect(keyA).toBe("menus.m1.elements.a.default.title");
    expect(keyB).toBe("menus.m1.elements.b.default.title");
    // ...and distinct, so editing one element cannot rewrite the other's text.
    expect(keyA).not.toBe(keyB);

    // Both languages survive on BOTH elements — the shared-template trap.
    expect(p.i18nKeys[keyA]).toEqual({ en: "Sword", fr: "Épée" });
    expect(p.i18nKeys[keyB]).toEqual({ en: "Sword", fr: "Épée" });

    // The old address is not left behind as an orphan.
    expect(p.i18nKeys["item_templates.tpl1.default.title" as I18nKey]).toBeUndefined();
  });

  it("never writes templates/ back out", () => {
    const files = transform(projectFromFiles(PID, legacyFiles()));

    expect(Object.keys(files).filter((f) => f.includes("/templates/"))).toEqual([]);
    expect(files[`${base}/menus/m1.yaml`]).not.toContain("template:");
    // The manifest no longer advertises a templates list.
    expect(files[`${base}/manifest.yaml`]).not.toContain("templates:");

    // Both elements' text is field-local in the menu document, in every language.
    const menu = files[`${base}/menus/m1.yaml`]!;
    expect(menu).toContain("Sword");
    expect(menu).toContain("Épée");
    // Structural text no longer travels in lang/ (ADR field-local-translations).
    expect(files[`${base}/lang/fr.yaml`] ?? "").not.toContain("Épée");
  });

  it("keeps a dangling template ref harmless", () => {
    const files = legacyFiles();
    delete files[`${base}/templates/tpl1.yaml`];
    const p = projectFromFiles(PID, files);
    const [a] = elementsOf(p);

    // Non-hermetic by design: the element simply has no appearance content.
    expect(a!.display).toEqual({});
    expect(a!.states).toEqual([]);
    expect(a!.iterates?.source).toBe("items");
  });
});
