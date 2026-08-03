import { rekeyProject, visitProjectLTexts } from "@/domain/i18nSites";
import { commandId, dialogId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { Dialog, I18nKey, Menu, Project } from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { transform } from "./transform";

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
    menus: [],
    commands: [],
    dialogs: [],
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
            appearances: [
              {
                material: "DIAMOND",
                title: { key: "menus.shop.elements.btn.default.title" as I18nKey },
                lore: { key: "menus.shop.elements.btn.default.lore" as I18nKey },
                click: {
                  left: {
                    steps: [
                      {
                        kind: "action",
                        action: {
                          type: "send_message",
                          text: {
                            key: "menus.shop.elements.btn.default.click.left.message" as I18nKey,
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
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

const inlineProject = (overrides: Partial<Project> = {}): Project =>
  makeProject({ i18nMode: "inline", menus: [shopMenu()], i18nKeys: { ...I18N }, ...overrides });

const langFile = (files: Record<string, string>, lang: string) => {
  const raw = files[`${BASE}/lang/${lang}.yaml`];
  return raw === undefined ? undefined : flattenLangTree(parse(raw));
};

describe("transform — inline i18n mode", () => {
  it("writes the default language's literal text into the menu document", () => {
    const menu = parse(transform(inlineProject())[`${BASE}/menus/shop.yaml`]!);
    expect(menu.title).toEqual([{ kind: "text", value: "Shop", x: 8, y: 5 }]);
    const app = menu.elements[0].appearances[0];
    expect(app.title).toBe("Sword");
    expect(app.lore).toEqual(["Sharp"]);
    // Click handler is an Action DSL string — the text is a quoted literal, not `@key`.
    expect(app.click.left).toContain('"Bought!"');
    expect(app.click.left).not.toContain("@menus.");
  });

  it("emits no lang file for the default language — the documents carry it", () => {
    const files = transform(inlineProject());
    expect(langFile(files, "en")).toBeUndefined();
  });

  it("emits other languages at the canonical addresses of their key sites", () => {
    const files = transform(inlineProject());
    expect(langFile(files, "fr")).toEqual({
      "menus.shop.title": "Boutique",
      "menus.shop.elements.btn.default.title": "Épée",
      "menus.shop.elements.btn.default.lore": "Tranchante",
      "menus.shop.elements.btn.default.click.left.message": "Acheté !",
    });
  });

  it("inlines an empty string when the default language has no text yet", () => {
    const files = transform(inlineProject({ i18nKeys: {} as Project["i18nKeys"] }));
    const menu = parse(files[`${BASE}/menus/shop.yaml`]!);
    expect(menu.elements[0].appearances[0].title).toBe("");
  });

  it("inlines command and dialog texts too", () => {
    const project = inlineProject({
      menus: [],
      commands: [
        {
          id: commandId("heal"),
          projectId: projectId("p_test"),
          name: "heal",
          arguments: [],
          steps: [
            {
              kind: "action",
              action: { type: "send_message", text: { key: "commands.heal.message" as I18nKey } },
            },
          ],
        },
      ],
      dialogs: [
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
      i18nKeys: {
        "commands.heal.message": { en: "Healed", fr: "Soigné" },
        "dialogs.confirm.title": { en: "Sure?", fr: "Sûr ?" },
        "dialogs.confirm.body.0.text": { en: "Confirm", fr: "Confirmer" },
        "dialogs.confirm.buttons.ok.label": { en: "OK", fr: "OK" },
      } as Project["i18nKeys"],
    });
    const files = transform(project);
    expect(parse(files[`${BASE}/commands/heal.yaml`]!).actions).toContain('"Healed"');
    const dialog = parse(files[`${BASE}/dialogs/confirm.yaml`]!);
    expect(dialog.title).toBe("Sure?");
    expect(dialog.body[0].text).toBe("Confirm");
    expect(dialog.buttons[0].label).toBe("OK");
    expect(langFile(files, "fr")).toMatchObject({
      "commands.heal.message": "Soigné",
      "dialogs.confirm.title": "Sûr ?",
      "dialogs.confirm.body.0.text": "Confirmer",
    });
  });

  it("records the mode in .artisan/editor.yaml so a re-import keeps it", () => {
    const state = parse(transform(inlineProject())[`${BASE}/.artisan/editor.yaml`]!);
    expect(state.i18n_mode).toBe("inline");
  });
});

describe("inline i18n mode — round-trip through the file tree", () => {
  const reimport = (project: Project) =>
    projectFromFiles(projectId("p_test"), transform(project), { name: "Test" });

  it("keeps the mode, so a save doesn't silently flip the tree back", () => {
    expect(reimport(inlineProject()).i18nMode).toBe("inline");
    expect(reimport(makeProject({ menus: [shopMenu()] })).i18nMode).toBeUndefined();
  });

  it("reattaches the other languages to their key sites", () => {
    const back = reimport(inlineProject());
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
    const once = transform(inlineProject());
    const back = reimport(inlineProject());
    rekeyProject(back);
    const twice = transform(back);
    for (const path of Object.keys(once)) expect([path, twice[path]]).toEqual([path, once[path]]);
    expect(Object.keys(twice).sort()).toEqual(Object.keys(once).sort());
  });
});

describe("transform — extract i18n mode (default)", () => {
  it("keeps {i18n:key} refs and the default language file", () => {
    const files = transform(makeProject({ menus: [shopMenu()], i18nKeys: { ...I18N } }));
    const menu = parse(files[`${BASE}/menus/shop.yaml`]!);
    expect(menu.title[0].value).toBe("{i18n:menus.shop.title}");
    expect(menu.elements[0].appearances[0].title).toBe(
      "{i18n:menus.shop.elements.btn.default.title}",
    );
    expect(langFile(files, "en")).toMatchObject({ "menus.shop.title": "Shop" });
    expect(langFile(files, "fr")).toMatchObject({ "menus.shop.title": "Boutique" });
  });

  it("writes no i18n_mode marker", () => {
    const raw = transform(makeProject({ menus: [shopMenu()] }))[`${BASE}/.artisan/editor.yaml`];
    expect(raw === undefined ? undefined : parse(raw).i18n_mode).toBeUndefined();
  });
});
