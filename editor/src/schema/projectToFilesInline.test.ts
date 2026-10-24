import { rekeyProject, visitProjectLTexts } from "@/domain/i18nSites";
import { commandId, dialogId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { Dialog, I18nKey, Menu, Project } from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { projectToFiles } from "./projectToFiles";

const BASE = "plugins/Artisan/projects/p_test";

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: projectId("p_test"),
    name: "Test",
    description: "",
    source: "user_created",
    defaultLang: "en",
    createdAt: "",
    updatedAt: "",
    i18nKeys: {},
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    assets: [],
    canvasLayout: {},
    ...overrides,
  }) as Project;

/** Menu with a titled/lored element whose left click sends a message. */
const shopMenu = (): Menu =>
  ({
    id: menuId("shop"),
    projectId: projectId("p_test"),
    rows: 3,
    title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
    layers: [
      {
        id: layerId("l1"),
        name: "default",
        elements: [
          {
            id: elementId("btn"),
            positions: "13",
            display: {
              material: "DIAMOND",
              title: { key: "menus.shop.elements.btn.default.title" as I18nKey },
              lore: { key: "menus.shop.elements.btn.default.lore" as I18nKey },
              click: {
                left: {
                  steps: [
                    {
                      kind: "action",
                      action: {
                        name: "send_message",
                        value: {
                          key: "menus.shop.elements.btn.default.click.left.message" as I18nKey,
                        },
                      },
                    },
                  ],
                },
              },
            },
            states: [],
          },
        ],
      },
    ],
  }) as unknown as Menu;

const I18N = {
  "menus.shop.title": { en: "Shop", fr: "Boutique" },
  "menus.shop.elements.btn.default.title": { en: "Sword", fr: "Épée" },
  "menus.shop.elements.btn.default.lore": { en: "Sharp", fr: "Tranchante" },
  "menus.shop.elements.btn.default.click.left.message": { en: "Bought!", fr: "Acheté !" },
} as Project["i18nKeys"];

/** i18nMode is a legacy flag; structural text is field-local regardless. */
const project = (overrides: Partial<Project> = {}): Project =>
  makeProject({ documents: { menu: [shopMenu()] }, i18nKeys: { ...I18N }, ...overrides });

const langFile = (files: Record<string, string>, lang: string) => {
  const raw = files[`${BASE}/lang/${lang}.yml`];
  return raw === undefined ? undefined : flattenLangTree(parse(raw));
};

describe("projectToFiles — structural text is field-local", () => {
  it("writes a {lang: text} map for translated title, lore and layers", () => {
    const menu = parse(projectToFiles(project())[`${BASE}/menus/shop.yml`]!);
    expect(menu.title).toEqual([
      { kind: "text", value: { en: "Shop", fr: "Boutique" }, x: 8, y: 5 },
    ]);
    const app = menu.elements[0];
    expect(app.title).toEqual({ en: "Sword", fr: "Épée" });
    expect(app.lore).toEqual({ en: ["Sharp"], fr: ["Tranchante"] });
  });

  it("writes a multi-line lore as one list per language, line counts free", () => {
    const i18nKeys = {
      ...I18N,
      "menus.shop.elements.btn.default.lore": {
        en: "Sharp\n\nClick to buy",
        fr: "Tranchante\nCliquer pour acheter",
      },
    };
    const menu = parse(projectToFiles(project({ i18nKeys }))[`${BASE}/menus/shop.yml`]!);
    expect(menu.elements[0].lore).toEqual({
      en: ["Sharp", "", "Click to buy"],
      fr: ["Tranchante", "Cliquer pour acheter"],
    });
  });

  it("writes a default-language-only lore as a plain list of lines", () => {
    const i18nKeys = { ...I18N, "menus.shop.elements.btn.default.lore": { en: "Sharp\nShiny" } };
    const menu = parse(projectToFiles(project({ i18nKeys }))[`${BASE}/menus/shop.yml`]!);
    expect(menu.elements[0].lore).toEqual(["Sharp", "Shiny"]);
  });

  it("emits a bare string when only the default language has a value", () => {
    const menu = parse(
      projectToFiles(
        project({ i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"] }),
      )[`${BASE}/menus/shop.yml`]!,
    );
    expect(menu.title[0].value).toBe("Shop");
    // Untranslated keys with no value land as empty strings, never a raw key.
    expect(menu.elements[0].title).toBe("");
  });

  it("keeps a text written only in a non-default language as a map", () => {
    const menu = parse(
      projectToFiles(
        project({ i18nKeys: { "menus.shop.title": { fr: "Boutique" } } as Project["i18nKeys"] }),
      )[`${BASE}/menus/shop.yml`]!,
    );
    // A bare string would mean the default language (en) — and was "" before.
    expect(menu.title[0].value).toEqual({ fr: "Boutique" });
  });

  it("makes action text field-local too", () => {
    const files = projectToFiles(project());
    const menu = parse(files[`${BASE}/menus/shop.yml`]!);
    expect(menu.elements[0].click.left).toEqual([
      { send_message: { en: "Bought!", fr: "Acheté !" } },
    ]);
    // No action key in lang/ anymore.
    expect(
      langFile(files, "en")?.["menus.shop.elements.btn.default.click.left.message"],
    ).toBeUndefined();
  });

  it("leaves structural keys out of lang/", () => {
    const fr = langFile(projectToFiles(project()), "fr") ?? {};
    expect(fr["menus.shop.title"]).toBeUndefined();
    expect(fr["menus.shop.elements.btn.default.title"]).toBeUndefined();
    expect(fr["menus.shop.elements.btn.default.lore"]).toBeUndefined();
  });

  it("inlines command and dialog structural texts too", () => {
    const p = project({
      documents: {
        menu: [],
        command: [
          {
            id: commandId("heal"),
            projectId: projectId("p_test"),
            name: "heal",
            arguments: [],
            steps: [
              {
                kind: "action",
                action: {
                  name: "send_message",
                  value: { key: "commands.heal.message" as I18nKey },
                },
              },
            ],
          },
        ],
        dialog: [
          {
            id: dialogId("confirm"),
            projectId: projectId("p_test"),
            title: { key: "dialogs.confirm.title" as I18nKey },
            canCloseWithEscape: true,
            body: [{ type: "text", text: { key: "dialogs.confirm.body.0.text" as I18nKey } }],
            inputs: [],
            buttons: [
              {
                id: "ok",
                label: { key: "dialogs.confirm.buttons.ok.label" as I18nKey },
                steps: [],
              },
            ],
          } as unknown as Dialog,
        ],
      },
      i18nKeys: {
        "commands.heal.message": { en: "Healed", fr: "Soigné" },
        "dialogs.confirm.title": { en: "Sure?", fr: "Sûr ?" },
        "dialogs.confirm.body.0.text": { en: "Confirm", fr: "Confirmer" },
        "dialogs.confirm.buttons.ok.label": { en: "OK", fr: "OK" },
      } as Project["i18nKeys"],
    });
    const files = projectToFiles(p);
    expect(parse(files[`${BASE}/commands/heal.yml`]!).actions).toEqual([
      { send_message: { en: "Healed", fr: "Soigné" } },
    ]);
    const dialog = parse(files[`${BASE}/dialogs/confirm.yml`]!);
    expect(dialog.title).toEqual({ en: "Sure?", fr: "Sûr ?" });
    expect(dialog.body[0].text).toEqual({ en: "Confirm", fr: "Confirmer" });
    expect(dialog.buttons[0].label).toEqual({ en: "OK", fr: "OK" });
    // Action text is field-local now — nothing document-related stays in lang/.
    const fr = langFile(files, "fr") ?? {};
    expect(fr["commands.heal.message"]).toBeUndefined();
    expect(fr["dialogs.confirm.title"]).toBeUndefined();
  });
});

describe("field-local — round-trip through the file tree", () => {
  const reimport = (p: Project) =>
    projectFromFiles(projectId("p_test"), projectToFiles(p), { name: "Test" });

  it("reattaches the languages to their key sites", () => {
    const back = reimport(project());
    const texts = [...visitProjectLTexts(back)].map((s) => [
      s.key,
      back.i18nKeys[back.i18nKeys[s.lText.key] ? s.lText.key : s.key],
    ]);
    expect(Object.fromEntries(texts)).toEqual({
      "menus.shop.title": { en: "Shop", fr: "Boutique" },
      "menus.shop.elements.btn.default.title": { en: "Sword", fr: "Épée" },
      "menus.shop.elements.btn.default.lore": { en: "Sharp", fr: "Tranchante" },
      "menus.shop.elements.btn.default.click.left.message": { en: "Bought!", fr: "Acheté !" },
    });
  });

  it("is a fixed point — re-exporting the imported project yields the same tree", () => {
    const once = projectToFiles(project());
    const back = reimport(project());
    rekeyProject(back);
    const twice = projectToFiles(back);
    for (const path of Object.keys(once)) expect([path, twice[path]]).toEqual([path, once[path]]);
    expect(Object.keys(twice).sort()).toEqual(Object.keys(once).sort());
  });
});

describe("legacy i18n_mode marker", () => {
  it("keeps the inline marker so a re-import round-trips it", () => {
    const files = projectToFiles(project({ i18nMode: "inline" }));
    expect(parse(files[`${BASE}/.artisan/editor.yaml`]!).i18n_mode).toBe("inline");
  });
});
