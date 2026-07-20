import { dialogId, elementId, menuId, projectId } from "@/domain/ids";
import { gridArrange } from "@/features/canvas/autoLayout";
import type { I18nKey, MenuTitleLayer } from "@/domain/types";
import { mockAccount } from "@/mock/fixtures";
import { produce } from "immer";
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

const PERSONAL = projectId("p_personal");
const SHOP_MAIN = menuId("m_shop_main");
const PROFILE_BTN = elementId("el_btn_profile");

const findElement = (mId = SHOP_MAIN, eId = PROFILE_BTN) => {
  const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
  const menu = pack.menus.find((m) => m.id === mId)!;
  return menu.layers[0]!.elements.find((el) => el.id === eId);
};

describe("accountStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  describe("applyAssistantTranslations", () => {
    it("merges per-key/per-lang values without touching other languages", () => {
      const K = "menus.shop.title" as I18nKey;
      useAccountStore.getState().setI18nValue({ projectId: PERSONAL, lt: { key: K }, lang: "fr", value: "&6Boutique" });
      useAccountStore.getState().setI18nValue({ projectId: PERSONAL, lt: { key: K }, lang: "en", value: "&6Shop" });
      useAccountStore.getState().applyAssistantTranslations({
        projectId: PERSONAL,
        entries: { [K]: { fr: "<gold>Boutique" }, ["new.key" as I18nKey]: { fr: "Neuf" } },
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect(pack.i18nKeys[K]).toEqual({ fr: "<gold>Boutique", en: "&6Shop" });
      expect(pack.i18nKeys["new.key" as I18nKey]).toEqual({ fr: "Neuf" });
    });
  });

  describe("item templates", () => {
    const TPL = "tpl_shop" as import("@/domain/types").ItemTemplateId;
    const getPack = () =>
      useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const baseTemplate = () => ({
      id: TPL,
      projectId: PERSONAL,
      name: "Vue boutique",
      sourceRef: "boutique:items",
      alias: "item",
      keyField: "id",
      groupBy: "category",
      // Sentinel keys ("") — addItemTemplate mints canonical i18n entries for them.
      appearances: [{ material: "{item.icon}", title: { key: "" as I18nKey } }],
    });

    it("addItemTemplate appends and mints sentinel LText keys under canonical paths", () => {
      useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
      const pack = getPack();
      const tpl = pack.itemTemplates!.find((t) => t.id === TPL)!;
      expect(tpl.name).toBe("Vue boutique");
      const titleKey = tpl.appearances[0]!.title!.key;
      expect(titleKey).toBe("item_templates.tpl_shop.default.title");
      expect(pack.i18nKeys[titleKey]).toBeDefined();
    });

    it("addItemTemplate merges seed i18n entries (all languages) before minting", () => {
      const K = "item_templates.tpl_shop.default.title" as I18nKey;
      useAccountStore.getState().addItemTemplate({
        projectId: PERSONAL,
        template: {
          ...baseTemplate(),
          appearances: [{ material: "{item.icon}", title: { key: K } }],
        },
        i18n: { [K]: { en: "{item.name}", fr: "{item.name} !" } },
      });
      const pack = getPack();
      expect(pack.i18nKeys[K]).toEqual({ en: "{item.name}", fr: "{item.name} !" });
    });

    it("updateItemTemplate patches name/groupBy without touching appearances", () => {
      useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
      useAccountStore.getState().updateItemTemplate({
        projectId: PERSONAL,
        templateId: TPL,
        patch: { name: "Vue compacte", groupBy: undefined },
      });
      const tpl = getPack().itemTemplates!.find((t) => t.id === TPL)!;
      expect(tpl.name).toBe("Vue compacte");
      expect(tpl.groupBy).toBeUndefined();
      expect(tpl.appearances).toHaveLength(1);
    });

    it("setItemTemplateAppearances replaces states, mints new sentinels and releases dropped keys", () => {
      useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
      const oldKey = getPack().itemTemplates![0]!.appearances[0]!.title!.key;
      useAccountStore.getState().setItemTemplateAppearances({
        projectId: PERSONAL,
        templateId: TPL,
        appearances: [
          { material: "{item.icon}", lore: { key: "" as I18nKey } }, // no title anymore
        ],
      });
      const pack = getPack();
      const tpl = pack.itemTemplates![0]!;
      expect(tpl.appearances[0]!.title).toBeUndefined();
      const loreKey = tpl.appearances[0]!.lore!.key;
      expect(loreKey).toBe("item_templates.tpl_shop.default.lore");
      expect(pack.i18nKeys[loreKey]).toBeDefined();
      // The dropped title key must be GC'd — no "(unused)" leak.
      expect(pack.i18nKeys[oldKey]).toBeUndefined();
    });

    describe("template-addressed appearance reducers (AppearanceTarget)", () => {
      const add = () =>
        useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
      const tpl = () => getPack().itemTemplates!.find((t) => t.id === TPL)!;

      it("setAppearanceField targets a template state via templateId", () => {
        add();
        useAccountStore.getState().setAppearanceField({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 0,
          field: "material",
          value: "DIAMOND",
        });
        expect(tpl().appearances[0]!.material).toBe("DIAMOND");
      });

      it("setAppearanceTitle mints the canonical item_templates key on first write", () => {
        add();
        // Strip the title so the lazy-allocation path runs.
        useAccountStore.getState().setItemTemplateAppearances({
          projectId: PERSONAL,
          templateId: TPL,
          appearances: [{ material: "{item.icon}" }],
        });
        useAccountStore.getState().setAppearanceTitle({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 0,
          lang: "en",
          value: "{item.name}",
        });
        const app = tpl().appearances[0]!;
        expect(app.title!.key).toBe("item_templates.tpl_shop.default.title");
        expect(getPack().i18nKeys[app.title!.key]).toEqual({ en: "{item.name}" });
      });

      it("click handler + step lifecycle on a template state mints keys under the template prefix", () => {
        add();
        const s = useAccountStore.getState();
        s.addElementClickHandler({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 0,
          clickType: "left",
        });
        expect(tpl().appearances[0]!.click!.left).toEqual({ steps: [] });
        useAccountStore.getState().addElementStep({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 0,
          clickType: "left",
          frames: [],
          index: -1,
          step: {
            kind: "action",
            action: { type: "send_message", text: { key: "" as I18nKey } },
          },
          lang: "en",
        });
        const step = tpl().appearances[0]!.click!.left!.steps[0]!;
        expect(step.kind).toBe("action");
        const key = (step as { action: { text: { key: string } } }).action.text.key;
        expect(key).toBe("item_templates.tpl_shop.default.click.left.message");
        expect(getPack().i18nKeys[key as I18nKey]).toBeDefined();
        // Removing the handler GCs its step keys.
        useAccountStore.getState().removeElementClickHandler({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 0,
          clickType: "left",
        });
        expect(tpl().appearances[0]!.click!.left).toBeUndefined();
        expect(getPack().i18nKeys[key as I18nKey]).toBeUndefined();
      });

      it("addAppearance / removeAppearance target template states and GC released keys", () => {
        add();
        useAccountStore.getState().addAppearance({ projectId: PERSONAL, templateId: TPL });
        expect(tpl().appearances).toHaveLength(2);
        expect(tpl().appearances[1]!.if).toBeDefined();
        // Give state 1 a title, then remove it — key must be GC'd.
        useAccountStore.getState().setAppearanceTitle({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 1,
          lang: "en",
          value: "Hover",
        });
        const key = tpl().appearances[1]!.title!.key;
        expect(key).toBe("item_templates.tpl_shop.state1.title");
        useAccountStore.getState().removeAppearance({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 1,
        });
        expect(tpl().appearances).toHaveLength(1);
        expect(getPack().i18nKeys[key]).toBeUndefined();
      });

      it("setAppearanceConditions targets a template state", () => {
        add();
        useAccountStore.getState().setAppearanceConditions({
          projectId: PERSONAL,
          templateId: TPL,
          appearanceIndex: 0,
          conditions: [{ type: "has_permission", perm: "shop.vip" }],
        });
        expect(tpl().appearances[0]!.if).toEqual([{ type: "has_permission", perm: "shop.vip" }]);
      });
    });

    describe("bindElementToTemplate", () => {
      it("binds an existing element: ensures the source input and sets iterates", () => {
        useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
        const mId = useAccountStore.getState().createMenu({ projectId: PERSONAL, id: "m_bind" });
        // A plain element dropped from the library (no iteration yet).
        useAccountStore.getState().setSlotMaterial({ projectId: PERSONAL, menuId: mId, position: 10, material: "CHEST" });
        const pack0 = getPack();
        const el0 = pack0.menus.find((m) => m.id === mId)!.layers[0]!.elements[0]!;
        const res = useAccountStore.getState().bindElementToTemplate({
          projectId: PERSONAL,
          menuId: mId,
          elementId: el0.id,
          templateId: TPL,
        });
        expect(res.ok).toBe(true);
        const menu = getPack().menus.find((m) => m.id === mId)!;
        const el = menu.layers[0]!.elements[0]!;
        // Context input auto-created from the source ref tail.
        expect(menu.contextInputs).toEqual([
          { kind: "sourceRef", name: "items", ref: "boutique:items" },
        ]);
        expect(el.iterates).toEqual({ source: "items", alias: "item", templateId: TPL });
        expect(el.places).toBeUndefined();
      });

      it("refuses when another template of the same source is already bound in the menu", () => {
        useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
        useAccountStore.getState().addItemTemplate({
          projectId: PERSONAL,
          template: { ...baseTemplate(), id: "tpl_other" as never, name: "Autre vue" },
        });
        const mId = useAccountStore.getState().createMenu({ projectId: PERSONAL, id: "m_bind2" });
        useAccountStore.getState().setSlotMaterial({ projectId: PERSONAL, menuId: mId, position: 10, material: "CHEST" });
        useAccountStore.getState().setSlotMaterial({ projectId: PERSONAL, menuId: mId, position: 11, material: "CHEST" });
        const menu0 = getPack().menus.find((m) => m.id === mId)!;
        const [a, b] = menu0.layers[0]!.elements;
        useAccountStore.getState().bindElementToTemplate({
          projectId: PERSONAL, menuId: mId, elementId: a!.id, templateId: TPL,
        });
        const res = useAccountStore.getState().bindElementToTemplate({
          projectId: PERSONAL, menuId: mId, elementId: b!.id, templateId: "tpl_other" as never,
        });
        expect(res).toEqual({ ok: false, reason: "conflict", conflictName: "Vue boutique" });
      });
    });

    describe("pinItemTemplateRow / dropItemTemplateBlock", () => {
      const setup = () => {
        useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
        return useAccountStore.getState().createMenu({ projectId: PERSONAL, id: "m_tpl_target" });
      };

      it("first drop creates the context input + a bound element, then upserts placements", () => {
        const mId = setup();
        const r1 = useAccountStore.getState().pinItemTemplateRow({
          projectId: PERSONAL, menuId: mId, templateId: TPL, key: "sword", position: 4,
        });
        expect(r1.ok).toBe(true);
        const menu = getPack().menus.find((m) => m.id === mId)!;
        // Context input auto-created, named from the ref tail.
        expect(menu.contextInputs).toEqual([
          { kind: "sourceRef", name: "items", ref: "boutique:items" },
        ]);
        const el = menu.layers.flatMap((l) => l.elements).find((e) => e.places)!;
        expect(el.places).toMatchObject({
          source: "items", alias: "item", keyField: "id", templateId: TPL,
          placements: [{ key: "sword", page: 0, position: 4 }],
        });
        expect(el.appearances).toEqual([]); // template-bound: no local appearances

        // Second drop reuses the same element.
        useAccountStore.getState().pinItemTemplateRow({
          projectId: PERSONAL, menuId: mId, templateId: TPL, key: "apple", position: 5,
        });
        const el2 = getPack().menus.find((m) => m.id === mId)!.layers
          .flatMap((l) => l.elements).filter((e) => e.places);
        expect(el2).toHaveLength(1);
        expect(el2[0]!.places!.placements).toHaveLength(2);
      });

      it("blocks a second template of the same source in the same menu (one set per menu-source)", () => {
        const mId = setup();
        useAccountStore.getState().addItemTemplate({
          projectId: PERSONAL,
          template: { ...baseTemplate(), id: "tpl_other" as never, name: "Vue compacte" },
        });
        useAccountStore.getState().pinItemTemplateRow({
          projectId: PERSONAL, menuId: mId, templateId: TPL, key: "sword", position: 4,
        });
        const r = useAccountStore.getState().pinItemTemplateRow({
          projectId: PERSONAL, menuId: mId, templateId: "tpl_other" as never, key: "apple", position: 5,
        });
        expect(r).toEqual({ ok: false, reason: "conflict", conflictName: "Vue boutique" });
      });

      it("dropping a group creates a dedicated literal-filtered context input + its own element", () => {
        const mId = setup();
        const r = useAccountStore.getState().dropItemTemplateBlock({
          projectId: PERSONAL, menuId: mId, templateId: TPL,
          group: { field: "category", value: "weapons" },
        });
        expect(r.ok).toBe(true);
        const menu = getPack().menus.find((m) => m.id === mId)!;
        expect(menu.contextInputs).toEqual([
          { kind: "sourceRef", name: "items_weapons", ref: "boutique:items", filter: { category: "weapons" } },
        ]);
        const el = menu.layers.flatMap((l) => l.elements).find((e) => e.iterates)!;
        expect(el.iterates).toMatchObject({ source: "items_weapons", templateId: TPL });

        // A second group of the same template → its own input + element, no conflict.
        const r2 = useAccountStore.getState().dropItemTemplateBlock({
          projectId: PERSONAL, menuId: mId, templateId: TPL,
          group: { field: "category", value: "food" },
        });
        expect(r2.ok).toBe(true);
        const menu2 = getPack().menus.find((m) => m.id === mId)!;
        expect(menu2.contextInputs).toHaveLength(2);
        expect(menu2.layers.flatMap((l) => l.elements).filter((e) => e.iterates)).toHaveLength(2);

        // Re-dropping the same group reuses its element (no duplicate).
        useAccountStore.getState().dropItemTemplateBlock({
          projectId: PERSONAL, menuId: mId, templateId: TPL,
          group: { field: "category", value: "weapons" },
        });
        expect(
          getPack().menus.find((m) => m.id === mId)!.layers.flatMap((l) => l.elements)
            .filter((e) => e.iterates),
        ).toHaveLength(2);
      });

      it("dropItemTemplateBlock creates a paginated bound element with a sensible slot range", () => {
        const mId = setup();
        const r = useAccountStore.getState().dropItemTemplateBlock({
          projectId: PERSONAL, menuId: mId, templateId: TPL,
        });
        expect(r.ok).toBe(true);
        const menu = getPack().menus.find((m) => m.id === mId)!;
        const el = menu.layers.flatMap((l) => l.elements).find((e) => e.iterates)!;
        expect(el.iterates).toMatchObject({ source: "items", alias: "item", templateId: TPL });
        expect(el.appearances).toEqual([]);
        expect(el.positions.length).toBeGreaterThan(0); // auto slot range
      });
    });

    it("addCapturedItem appends (init array) and removeCapturedItem drops by id", () => {
      const item = {
        id: "ci_key" as never,
        name: "Clé Luxury",
        stackYaml: "==: org.bukkit.inventory.ItemStack\n",
        display: { material: "nexo:arcanist_key", enchanted: true },
      };
      useAccountStore.getState().addCapturedItem({ projectId: PERSONAL, item });
      expect(getPack().capturedItems).toEqual([item]);
      // Same id re-captured → replaced, not duplicated.
      useAccountStore.getState().addCapturedItem({
        projectId: PERSONAL,
        item: { ...item, name: "Clé Luxury v2" },
      });
      expect(getPack().capturedItems).toHaveLength(1);
      expect(getPack().capturedItems![0]!.name).toBe("Clé Luxury v2");

      useAccountStore.getState().removeCapturedItem({ projectId: PERSONAL, itemId: "ci_key" as never });
      expect(getPack().capturedItems).toHaveLength(0);
    });

    it("removeItemTemplate deletes the template and releases its LText keys", () => {
      useAccountStore.getState().addItemTemplate({ projectId: PERSONAL, template: baseTemplate() });
      const titleKey = getPack().itemTemplates![0]!.appearances[0]!.title!.key;
      useAccountStore.getState().removeItemTemplate({ projectId: PERSONAL, templateId: TPL });
      const pack = getPack();
      expect(pack.itemTemplates ?? []).toHaveLength(0);
      expect(pack.i18nKeys[titleKey]).toBeUndefined();
    });
  });

  it("createDialog returns a DialogId and adds dialog to pack", () => {
    const dId = useAccountStore.getState().createDialog({
      projectId: PERSONAL,
      id: "d_test",
    });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.dialogs).toHaveLength(1);
    expect(pack.dialogs[0]!.id).toBe("d_test");
    expect(typeof dId).toBe("string");
  });

  it("createDialog with position sets canvasLayout", () => {
    useAccountStore.getState().createDialog({
      projectId: PERSONAL,
      id: "d_shop",
      position: { x: 100, y: 200 },
    });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect((pack.canvasLayout as Record<string, unknown>)["d_shop"]).toEqual({ x: 100, y: 200 });
  });

  describe("placement mode reducers", () => {
    const places = () => useAccountStore.getState().setElementPlaces;
    const base = { projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN };

    it("setElementPlaces sets the binding and clears iterates (XOR)", () => {
      useAccountStore.getState().setElementIterates({ ...base, iterates: { source: "items", alias: "item" } });
      expect(findElement()!.iterates).toBeDefined();
      places()({ ...base, places: { source: "items", alias: "item", keyField: "id", placements: [] } });
      expect(findElement()!.places?.keyField).toBe("id");
      expect(findElement()!.iterates).toBeUndefined();
    });

    it("setElementIterates clears a prior places binding (XOR both ways)", () => {
      places()({ ...base, places: { source: "items", alias: "item", keyField: "id", placements: [] } });
      useAccountStore.getState().setElementIterates({ ...base, iterates: { source: "items", alias: "item" } });
      expect(findElement()!.places).toBeUndefined();
      expect(findElement()!.iterates).toBeDefined();
    });

    it("setElementPlacement upserts by key; removeElementPlacement removes", () => {
      places()({ ...base, places: { source: "items", alias: "item", keyField: "id", placements: [] } });
      useAccountStore.getState().setElementPlacement({ ...base, placement: { key: "sword", page: 0, position: 10 } });
      useAccountStore.getState().setElementPlacement({ ...base, placement: { key: "sword", page: 0, position: 14 } }); // move
      useAccountStore.getState().setElementPlacement({ ...base, placement: { key: "apple", page: 1, position: 3 } });
      expect(findElement()!.places!.placements).toEqual([
        { key: "sword", page: 0, position: 14 },
        { key: "apple", page: 1, position: 3 },
      ]);
      useAccountStore.getState().removeElementPlacement({ ...base, key: "sword" });
      expect(findElement()!.places!.placements).toEqual([{ key: "apple", page: 1, position: 3 }]);
    });
  });

  it("setDialogTitle stores translation in i18nKeys", () => {
    useAccountStore.getState().createDialog({ projectId: PERSONAL, id: "d_greet" });
    useAccountStore.getState().setDialogTitle({ projectId: PERSONAL, dialogId: dialogId("d_greet"), lang: "en", value: "Hello!" });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const dialog = pack.dialogs.find((d) => d.id === "d_greet")!;
    expect(pack.i18nKeys[dialog.title.key]!["en"]).toBe("Hello!");
  });

  it("removeUnusedI18nKeys drops orphaned keys but keeps referenced ones", () => {
    const store = useAccountStore.getState();
    // Seed an orphan: setI18nValue against a key no tree node references.
    store.setI18nValue({
      projectId: PERSONAL,
      lt: { key: "lt_orphan_xyz" as I18nKey },
      lang: "en",
      value: "stale",
    });
    const usedKey = "menus.m_shop_main.title" as I18nKey; // referenced by the fixture menu title
    let pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.i18nKeys["lt_orphan_xyz" as I18nKey]).toBeTruthy();
    expect(pack.i18nKeys[usedKey]).toBeTruthy();

    store.removeUnusedI18nKeys({ projectId: PERSONAL });

    pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.i18nKeys["lt_orphan_xyz" as I18nKey]).toBeUndefined();
    expect(pack.i18nKeys[usedKey]).toBeTruthy();
  });

  it("deleteFromProject removes dialog and its canvas position", () => {
    useAccountStore.getState().createDialog({ projectId: PERSONAL, id: "d_bye", position: { x: 10, y: 10 } });
    useAccountStore.getState().deleteFromProject({ projectId: PERSONAL, nodeIds: ["d_bye"] });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.dialogs.some((d) => d.id === "d_bye")).toBe(false);
    expect((pack.canvasLayout as Record<string, unknown>)["d_bye"]).toBeUndefined();
  });

  it("setEdgeAnchor stores an endpoint override; clearEdgeAnchor removes it and the empty entry", () => {
    useAccountStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "m_shop_main->m_profile",
      end: "from",
      anchor: { side: "top", t: 0.3 },
    });
    let pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.canvasEdges!["m_shop_main->m_profile"]).toEqual({ from: { side: "top", t: 0.3 } });

    useAccountStore.getState().clearEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "m_shop_main->m_profile",
      end: "from",
    });
    pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.canvasEdges?.["m_shop_main->m_profile"]).toBeUndefined();
  });

  it("deleteFromProject prunes canvasEdges entries touching the deleted node", () => {
    useAccountStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "m_shop_main->m_about",
      end: "to",
      anchor: { side: "left", t: 0.5 },
    });
    useAccountStore.getState().deleteFromProject({ projectId: PERSONAL, nodeIds: ["m_about"] });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.canvasEdges?.["m_shop_main->m_about"]).toBeUndefined();
  });

  it("setMenuId rewrites canvasEdges keys", () => {
    useAccountStore.getState().setEdgeAnchor({
      projectId: PERSONAL,
      edgeId: "m_shop_main->m_profile",
      end: "from",
      anchor: { side: "bottom", t: 0.8 },
    });
    useAccountStore.getState().setMenuId({
      projectId: PERSONAL,
      oldId: menuId("m_profile"),
      newId: menuId("m_profile2"),
    });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.canvasEdges?.["m_shop_main->m_profile"]).toBeUndefined();
    expect(pack.canvasEdges?.["m_shop_main->m_profile2"]).toEqual({
      from: { side: "bottom", t: 0.8 },
    });
  });

  it("addDialogButton appends a button with LText", () => {
    useAccountStore.getState().createDialog({ projectId: PERSONAL, id: "d_multi" });
    useAccountStore.getState().addDialogButton({ projectId: PERSONAL, dialogId: dialogId("d_multi") });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const d = pack.dialogs.find((d) => d.id === "d_multi")!;
    expect(d.buttons).toHaveLength(2); // default btn_confirm + new one
  });

  it("starts with the seed account", () => {
    expect(useAccountStore.getState().account.projects).toHaveLength(3);
  });

  describe("moduleData", () => {
    it("setModuleData writes the module's namespace and preserves others", () => {
      useAccountStore.getState().setModuleData(PERSONAL, "boutique", { categories: [] });
      useAccountStore.getState().setModuleData(PERSONAL, "quests", { chains: 1 });
      const p = useAccountStore.getState().account.projects.find((x) => x.id === PERSONAL)!;
      expect(p.moduleData?.boutique).toEqual({ categories: [] });
      expect(p.moduleData?.quests).toEqual({ chains: 1 });
    });

    it("importProject preserves moduleData", () => {
      const source = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const id = useAccountStore.getState().importProject({
        pack: { ...source, moduleData: { boutique: { categories: [] } } },
      });
      const imported = useAccountStore.getState().account.projects.find((p) => p.id === id)!;
      expect(imported.moduleData?.boutique).toEqual({ categories: [] });
    });
  });

  it("createProject appends to projects and projectOrder", () => {
    useAccountStore.getState().createProject({ id: "new_pack" });
    const a = useAccountStore.getState().account;
    expect(a.projects).toHaveLength(4);
    expect(a.projectOrder).toHaveLength(4);
    expect(a.projects[3]!.name).toBe("new_pack");
  });

  it("reorderProjects rewrites projectOrder", () => {
    const original = useAccountStore.getState().account.projectOrder;
    const reversed = [...original].reverse();
    useAccountStore.getState().reorderProjects(reversed);
    expect(useAccountStore.getState().account.projectOrder).toEqual(reversed);
  });

  it("moveMenuToProject moves the menu across projects", () => {
    const fromId = projectId("p_personal");
    const toId = projectId("p_shop_system");
    const menuToMove = menuId("m_about");

    useAccountStore
      .getState()
      .moveMenuToProject({ menuId: menuToMove, fromProjectId: fromId, toProjectId: toId });

    const a = useAccountStore.getState().account;
    const from = a.projects.find((p) => p.id === fromId)!;
    const to = a.projects.find((p) => p.id === toId)!;
    expect(from.menus.some((m) => m.id === menuToMove)).toBe(false);
    expect(to.menus.some((m) => m.id === menuToMove)).toBe(true);
    expect(to.menus.find((m) => m.id === menuToMove)!.projectId).toBe(toId);
  });

  it("moveMenuToProject succeeds even when refs become dangling", () => {
    // m_shop_main has open_menu actions targeting menus in p_personal.
    // We no longer enforce hermeticity — the runtime is responsible for
    // tolerating missing targets — so the move just goes through.
    const fromId = projectId("p_personal");
    const toId = projectId("p_shop_system");
    const sourceMenu = menuId("m_shop_main");

    useAccountStore
      .getState()
      .moveMenuToProject({ menuId: sourceMenu, fromProjectId: fromId, toProjectId: toId });

    const a = useAccountStore.getState().account;
    expect(a.projects.find((p) => p.id === fromId)!.menus.some((m) => m.id === sourceMenu)).toBe(
      false,
    );
    expect(a.projects.find((p) => p.id === toId)!.menus.some((m) => m.id === sourceMenu)).toBe(true);
  });

  it("deleteFromProject removes a leaf menu and its canvas position", () => {
    const pId = projectId("p_personal");
    useAccountStore.getState().deleteFromProject({ projectId: pId, nodeIds: ["m_about"] });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === pId)!;
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(false);
    expect("m_about" in pack.canvasLayout).toBe(false);
  });

  it("deleteFromProject succeeds even when the menu has inbound refs", () => {
    // m_profile is referenced by m_shop_main's actions. Deleting it leaves
    // those refs dangling — that's fine; the runtime no-ops on missing
    // open_menu targets.
    const pId = projectId("p_personal");
    useAccountStore.getState().deleteFromProject({ projectId: pId, nodeIds: ["m_profile"] });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === pId)!;
    expect(pack.menus.some((m) => m.id === "m_profile")).toBe(false);
  });

  it("setSlotMaterial updates an existing element at that position", () => {
    useAccountStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "DIAMOND",
    });
    const pack = useAccountStore
      .getState()
      .account.projects.find((p) => p.id === projectId("p_personal"))!;
    const menu = pack.menus.find((m) => m.id === "m_shop_main")!;
    const el = menu.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.appearances[0]!.material).toBe("DIAMOND");
  });

  it("setSlotMaterial creates an element at an empty position", () => {
    useAccountStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_about"),
      position: 5,
      material: "PAPER",
    });
    const pack = useAccountStore
      .getState()
      .account.projects.find((p) => p.id === projectId("p_personal"))!;
    const menu = pack.menus.find((m) => m.id === "m_about")!;
    const el = menu.layers[0]!.elements.find((e) => e.positions === "5");
    expect(el?.appearances[0]?.material).toBe("PAPER");
  });

  it("setSlotMaterial uses material-based IDs (paper_1, paper_2, …)", () => {
    const pId = projectId("p_personal");
    const mId = menuId("m_about");
    useAccountStore.getState().setSlotMaterial({ projectId: pId, menuId: mId, position: 5, material: "PAPER" });
    useAccountStore.getState().setSlotMaterial({ projectId: pId, menuId: mId, position: 6, material: "PAPER" });
    useAccountStore.getState().setSlotMaterial({ projectId: pId, menuId: mId, position: 7, material: "DIRT" });
    const menu = useAccountStore.getState().account.projects.find((p) => p.id === pId)!
      .menus.find((m) => m.id === mId)!;
    const ids = menu.layers[0]!.elements.map((e) => e.id);
    expect(ids).toContain("paper_1");
    expect(ids).toContain("paper_2");
    expect(ids).toContain("dirt_1");
  });

  it("temporal.undo reverts a slot material change", () => {
    useAccountStore.temporal.getState().clear();
    useAccountStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "EMERALD",
    });
    expect(
      useAccountStore
        .getState()
        .account.projects.find((p) => p.id === "p_personal")!
        .menus.find((m) => m.id === "m_shop_main")!
        .layers[0]!.elements.find((e) => e.positions === "13")?.appearances[0]?.material,
    ).toBe("EMERALD");

    useAccountStore.temporal.getState().undo();

    expect(
      useAccountStore
        .getState()
        .account.projects.find((p) => p.id === "p_personal")!
        .menus.find((m) => m.id === "m_shop_main")!
        .layers[0]!.elements.find((e) => e.positions === "13")?.appearances[0]?.material,
    ).not.toBe("EMERALD");
  });

  it("setElementPositions replaces the element's positions string", () => {
    useAccountStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-2,13",
    });
    expect(findElement()?.positions).toBe("0-2,13");
  });

  it("addElementPosition (Alt+drag duplicate) extends the positions list", () => {
    useAccountStore.getState().addElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      position: 14,
    });
    expect(findElement()?.positions).toBe("13-14");
  });

  it("addElementPosition steals the slot from another element", () => {
    // Seed a second element at position 22, then duplicate the profile button onto it.
    useAccountStore.getState().setSlotMaterial({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      position: 22,
      material: "DIRT",
    });
    useAccountStore.getState().addElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      position: 22,
    });
    expect(findElement()?.positions).toBe("13,22");
    // The DIRT element lost its only position and was pruned entirely.
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const dirt = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveElementPosition relocates a single position", () => {
    useAccountStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "13",
    });
    useAccountStore.getState().moveElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      fromPosition: 13,
      toPosition: 4,
    });
    expect(findElement()?.positions).toBe("4");
  });

  it("moveElementPosition keeps multi-pos elements in sync", () => {
    useAccountStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-2",
    });
    useAccountStore.getState().moveElementPosition({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      fromPosition: 1,
      toPosition: 5,
    });
    expect(findElement()?.positions).toBe("0,2,5");
  });

  it("clearSlot on a multi-pos element removes only that position", () => {
    useAccountStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-3",
    });
    useAccountStore.getState().clearSlot({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 1 });
    expect(findElement()?.positions).toBe("0,2-3");
  });

  it("clearSlot deletes the element when its last position goes", () => {
    useAccountStore.getState().clearSlot({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 13 });
    expect(findElement()).toBeUndefined();
  });

  it("deleteElement removes the entire element regardless of position count", () => {
    useAccountStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0-8",
    });
    useAccountStore.getState().deleteElement({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
    });
    expect(findElement()).toBeUndefined();
  });

  it("addElement inserts a new element and strips conflicting positions from siblings", () => {
    // Seed a sibling element at position 5
    useAccountStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 5, material: "DIRT" });
    useAccountStore.getState().addElement({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      element: {
        id: elementId("el_pasted"),
        positions: "5,6",
        appearances: [{ material: "GOLD_INGOT" }],
      },
    });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    // addElement now renames the id following the material_N scheme (paste-friendly).
    const pasted = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "GOLD_INGOT");
    expect(pasted?.id).toMatch(/^gold_ingot_\d+$/);
    expect(pasted?.positions).toBe("5-6");
    // The DIRT element lost its only position and was pruned.
    const dirt = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("addElement clones i18n keys so original and duplicate are independent", () => {
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const original = menu.layers[0]!.elements.find((el) => el.id === PROFILE_BTN)!;
    const originalTitleKey = original.appearances[0]!.title?.key;
    if (!originalTitleKey) throw new Error("fixture missing title");

    // Simulate a clipboard paste: element with new ID but same LText key as the original.
    useAccountStore.getState().addElement({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      element: {
        id: elementId("el_pasted_clone"),
        positions: "20",
        appearances: [{ ...original.appearances[0]! }],
      },
    });

    const state = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const stateMenu = state.menus.find((m) => m.id === SHOP_MAIN)!;
    // addElement renumbers the id by material; locate the just-added element
    // by its new positions instead of the now-overwritten input id.
    const pasted = stateMenu.layers[0]!.elements.find((el) => el.positions === "20")!;
    const pastedTitleKey = pasted.appearances[0]!.title?.key;

    // Pasted element must have a different key.
    expect(pastedTitleKey).toBeDefined();
    expect(pastedTitleKey).not.toBe(originalTitleKey);
    // Both keys must exist in i18nKeys with the same value.
    expect(state.i18nKeys[originalTitleKey as I18nKey]).toBeDefined();
    expect(state.i18nKeys[pastedTitleKey as I18nKey]).toEqual(state.i18nKeys[originalTitleKey as I18nKey]);
  });

  it("moveSelectionByDelta shifts every selected element by (dCol, dRow)", () => {
    // m_shop_main has rows=3 → row indices 0..2.
    useAccountStore.getState().setElementPositions({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      positions: "0,1",
    });
    useAccountStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 9, material: "STONE" });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const stoneId = menu.layers[0]!.elements.find(
      (el) => el.appearances[0]?.material === "STONE",
    )!.id;

    useAccountStore.getState().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN, stoneId],
      dCol: 1,
      dRow: 1,
    });

    expect(findElement()?.positions).toBe("10-11");
    const stoneAfter = useAccountStore
      .getState()
      .account.projects.find((p) => p.id === PERSONAL)!
      .menus.find((m) => m.id === SHOP_MAIN)!
      .layers[0]!.elements.find((el) => el.id === stoneId);
    expect(stoneAfter?.positions).toBe("19");
  });

  it("moveSelectionByDelta strips claimed positions from non-target elements", () => {
    // PROFILE_BTN at 13. Add another element at 14, then drag PROFILE_BTN by +1
    useAccountStore
      .getState()
      .setSlotMaterial({ projectId: PERSONAL, menuId: SHOP_MAIN, position: 14, material: "DIRT" });
    useAccountStore.getState().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN],
      dCol: 1,
      dRow: 0,
    });
    expect(findElement()?.positions).toBe("14");
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
    const dirt = menu.layers[0]!.elements.find((el) => el.appearances[0]?.material === "DIRT");
    expect(dirt).toBeUndefined();
  });

  it("moveSelectionByDelta throws when the move goes out of bounds", () => {
    expect(() =>
      useAccountStore.getState().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 0,
        dRow: 99,
      }),
    ).toThrow(/outside the menu/);
    // Source unchanged.
    expect(findElement()?.positions).toBe("13");
  });

  it("moveSelectionByDelta respects the inventory type's grid (hopper = 5 cols × 1 row)", () => {
    // Turn SHOP_MAIN into a hopper: 5 columns, a single row.
    useAccountStore
      .getState()
      .setMenuField({ projectId: PERSONAL, menuId: SHOP_MAIN, field: "inventoryType", value: "hopper" });

    // Last hopper column is 4; moving right leaves the 5-wide grid → must throw
    // (a chest-assuming `% 9` would wrongly allow it and produce slot 5).
    useAccountStore
      .getState()
      .setElementPositions({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN, positions: "4" });
    expect(() =>
      useAccountStore.getState().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 1,
        dRow: 0,
      }),
    ).toThrow(/outside the menu/);
    expect(findElement()?.positions).toBe("4");

    // A hopper has a single row; moving down must throw (chest `menu.rows` bound
    // would wrongly allow it and produce slot 9).
    useAccountStore
      .getState()
      .setElementPositions({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN, positions: "0" });
    expect(() =>
      useAccountStore.getState().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementIds: [PROFILE_BTN],
        dCol: 0,
        dRow: 1,
      }),
    ).toThrow(/outside the menu/);

    // A valid in-row move still works: col 1 → col 2.
    useAccountStore
      .getState()
      .setElementPositions({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN, positions: "1" });
    useAccountStore.getState().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementIds: [PROFILE_BTN],
      dCol: 1,
      dRow: 0,
    });
    expect(findElement()?.positions).toBe("2");
  });

  it("addAppearance pushes a conditional state seeded with a placeholder permission", () => {
    useAccountStore
      .getState()
      .addAppearance({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN });
    const el = findElement()!;
    expect(el.appearances).toHaveLength(2);
    const seeded = el.appearances[1]!;
    expect(seeded.if?.[0]?.type).toBe("has_permission");
  });

  it("removeAppearance keeps at least one appearance and is otherwise idempotent on out-of-range", () => {
    // Add a state, then remove it.
    useAccountStore
      .getState()
      .addAppearance({ projectId: PERSONAL, menuId: SHOP_MAIN, elementId: PROFILE_BTN });
    useAccountStore.getState().removeAppearance({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 1,
    });
    expect(findElement()!.appearances).toHaveLength(1);
    // Removing the lone remaining appearance is a no-op (we keep one).
    useAccountStore.getState().removeAppearance({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
    });
    expect(findElement()!.appearances).toHaveLength(1);
  });

  it("addElementClickHandler creates an empty handler at clickType, removeElementClickHandler clears it", () => {
    useAccountStore.getState().addElementClickHandler({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "right",
    });
    expect(findElement()!.appearances[0]?.click?.right?.steps).toEqual([]);
    useAccountStore.getState().removeElementClickHandler({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "right",
    });
    expect(findElement()!.appearances[0]?.click?.right).toBeUndefined();
  });

  it("addElementStep appends and removeElementStep drops by path", () => {
    useAccountStore.getState().addElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      index: -1,
      step: { kind: "action", action: { type: "close_menu" } },
      lang: "en",
    });
    let steps = findElement()!.appearances[0]!.click!.left!.steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]?.kind).toBe("action");
    useAccountStore.getState().removeElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      path: { frames: [], index: 1 },
    });
    steps = findElement()!.appearances[0]!.click!.left!.steps;
    expect(steps).toHaveLength(1);
  });

  it("moveElementStep reorders steps within a chain", () => {
    useAccountStore.getState().addElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      index: -1,
      step: {
        kind: "action",
        action: { type: "send_message", text: { key: "" as I18nKey } },
      },
      lang: "en",
    });
    useAccountStore.getState().moveElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [],
      fromIndex: 1,
      toIndex: 0,
    });
    const steps = findElement()!.appearances[0]!.click!.left!.steps;
    expect(steps[0]?.kind === "action" && steps[0].action.type).toBe("send_message");
    expect(steps[1]?.kind === "action" && steps[1].action.type).toBe("open_menu");
  });

  it("addElementStep into an if-step's case descends through the path", () => {
    // Replace the existing chain with an if-step.
    useAccountStore.getState().setElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      path: { frames: [], index: 0 },
      step: { kind: "if", cases: [{ conditions: [], steps: [] }] },
      lang: "en",
    });
    useAccountStore.getState().addElementStep({
      projectId: PERSONAL,
      menuId: SHOP_MAIN,
      elementId: PROFILE_BTN,
      appearanceIndex: 0,
      clickType: "left",
      frames: [{ stepIndex: 0, descend: { case: 0 } }],
      index: 0,
      step: { kind: "action", action: { type: "close_menu" } },
      lang: "en",
    });
    const root = findElement()!.appearances[0]!.click!.left!.steps[0]!;
    if (root.kind !== "if") throw new Error("expected if");
    expect(root.cases[0]!.steps).toHaveLength(1);
    expect(root.cases[0]!.steps[0]?.kind).toBe("action");
  });

  describe("command arg order validation", () => {
    const pId = projectId("p_personal");

    it("addCommandArg throws when appending required after optional", () => {
      const cId = useAccountStore.getState().createCommand({ projectId: pId });
      useAccountStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      expect(() =>
        useAccountStore.getState().addCommandArg({
          projectId: pId,
          commandId: cId,
          arg: { name: "req", type: "string", required: true },
        }),
      ).toThrow(/cannot follow/);
    });

    it("setCommandArg throws when making an arg required after an optional one", () => {
      const cId = useAccountStore.getState().createCommand({ projectId: pId });
      useAccountStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      useAccountStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "second", type: "string", required: false },
      });
      expect(() =>
        useAccountStore.getState().setCommandArg({
          projectId: pId,
          commandId: cId,
          index: 1,
          arg: { name: "second", type: "string", required: true },
        }),
      ).toThrow(/cannot follow/);
    });

    it("valid order (required then optional) succeeds", () => {
      const cId = useAccountStore.getState().createCommand({ projectId: pId });
      useAccountStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "target", type: "player", required: true },
      });
      useAccountStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "amount", type: "integer", required: false },
      });
      const cmd = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .commands.find((c) => c.id === cId)!;
      expect(cmd.arguments).toHaveLength(2);
      expect(cmd.arguments[0]!.required).toBe(true);
      expect(cmd.arguments[1]!.required).toBe(false);
    });

    it("state is unchanged when validation throws", () => {
      const cId = useAccountStore.getState().createCommand({ projectId: pId });
      useAccountStore.getState().addCommandArg({
        projectId: pId,
        commandId: cId,
        arg: { name: "opt", type: "string", required: false },
      });
      try {
        useAccountStore.getState().addCommandArg({
          projectId: pId,
          commandId: cId,
          arg: { name: "req", type: "string", required: true },
        });
      } catch {
        // expected
      }
      const cmd = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .commands.find((c) => c.id === cId)!;
      expect(cmd.arguments).toHaveLength(1);
    });
  });

  describe("menu contextInput discriminated union", () => {
    it("addMenuContextInput with kind='primitive' adds a primitive input", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "primitive",
      });
      const menu = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const added = (menu.contextInputs ?? []).at(-1);
      expect(added?.kind).toBe("primitive");
      if (added?.kind === "primitive") {
        expect(added.type).toBe("string");
      }
    });

    it("addMenuContextInput with kind='sourceRef' adds a sourceRef input", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "sourceRef",
      });
      const menu = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const added = (menu.contextInputs ?? []).at(-1);
      expect(added?.kind).toBe("sourceRef");
    });

    it("setMenuContextInput persists a sourceRef input", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "sourceRef",
      });
      const before = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const idx = (before.contextInputs ?? []).findIndex((c) => c.kind === "sourceRef");
      expect(idx).toBeGreaterThanOrEqual(0);

      useAccountStore.getState().setMenuContextInput({
        projectId: pId,
        menuId: mId,
        index: idx,
        input: {
          kind: "sourceRef",
          name: "shops",
          ref: "chestshop:items" as import("@/domain/types").SourceRef,
        },
      });

      const after = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const stored = (after.contextInputs ?? []).find((c) => c.name === "shops");
      expect(stored?.kind).toBe("sourceRef");
      if (stored?.kind === "sourceRef") {
        expect(stored.ref).toBe("chestshop:items");
      }
    });

    it("setMenuContextInput can update a primitive input to a different type", () => {
      const pId = projectId("p_personal");
      const mId = menuId("m_shop_main");
      useAccountStore.getState().addMenuContextInput({
        projectId: pId,
        menuId: mId,
        kind: "primitive",
      });
      const before = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === pId)!
        .menus.find((m) => m.id === mId)!;
      const idx = (before.contextInputs ?? []).findIndex((c) => c.kind === "primitive");

      useAccountStore.getState().setMenuContextInput({
        projectId: pId,
        menuId: mId,
        index: idx,
        input: { kind: "primitive", name: "category", type: "player" },
      });

      const stored = (
        useAccountStore
          .getState()
          .account.projects.find((p) => p.id === pId)!
          .menus.find((m) => m.id === mId)!.contextInputs ?? []
      ).find((c) => c.name === "category");
      expect(stored?.kind).toBe("primitive");
      if (stored?.kind === "primitive") {
        expect(stored.type).toBe("player");
      }
    });
  });

  describe("DataSource reducers", () => {
    it("adds a table source with its auto-created Data model (Row key seeded)", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect(pack.dataSources).toHaveLength(1);
      const ds = pack.dataSources[0]!;
      expect(ds.name).toBe("new_source");
      expect(ds.shape).toBe("table");
      if (ds.shape !== "table") throw new Error("expected table");
      expect(ds.rows).toEqual([]);
      const model = pack.dataModels!.find((m) => m.id === ds.modelId)!;
      expect(model.name).toBe("new_source");
      expect(model.keyField).toBe("id");
      expect(model.fields).toEqual([{ name: "id", type: { kind: "string" } }]);
    });

    it("adds a config source without a model", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL, shape: "config" });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const ds = pack.dataSources[0]!;
      expect(ds.shape).toBe("config");
      if (ds.shape !== "config") throw new Error("expected config");
      expect(ds.fields).toEqual([]);
      expect(ds.value).toEqual({});
      expect(pack.dataModels ?? []).toHaveLength(0);
    });

    it("disambiguates duplicate names", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect(pack.dataSources[0]!.name).toBe("new_source");
      expect(pack.dataSources[1]!.name).toBe("new_source_2");
    });

    it("removes a data source by id and GCs its orphaned auto-model + i18n keys", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const pack0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const ds = pack0.dataSources[0]!;
      if (ds.shape !== "table") throw new Error("expected table");
      // Simulate an authored ltext row value backed by an i18n entry.
      useAccountStore.setState((s) =>
        produce(s, (draft) => {
          const pack = draft.account.projects.find((p) => p.id === PERSONAL)!;
          const model = pack.dataModels!.find((m) => m.id === (ds as { modelId: unknown }).modelId)!;
          model.fields.push({ name: "label", type: { kind: "ltext" } });
          (pack.dataSources[0] as { rows: unknown[] }).rows = [{ id: "r1", label: { key: "lt_x" } }];
          pack.i18nKeys["lt_x" as never] = { en: "Hello" };
        }),
      );
      useAccountStore.getState().removeProjectDataSource({ projectId: PERSONAL, id: ds.id });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect(pack.dataSources).toHaveLength(0);
      expect(pack.dataModels).toHaveLength(0);
      expect(pack.i18nKeys["lt_x" as never]).toBeUndefined();
    });

    it("row lifecycle: add seeds defaults + mints ltexts, cell set, remove releases keys", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const pack0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const ds0 = pack0.dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      // Declare: name (ltext) + icon (item) on the auto model.
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "name", type: { kind: "ltext" } } },
      });
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "icon", type: { kind: "item" } } },
      });
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: ds0.id });
      let pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      let row = (pack.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(row.id).toBe("row_1");
      expect(row.icon).toBe("");
      const lt = row.name as { key: string };
      // Minted: non-sentinel key backed by an i18n entry.
      expect(lt.key).not.toBe("");
      expect(lt.key).toContain(".row_1.");
      expect(pack.i18nKeys[lt.key as never]).toBeDefined();

      useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: 0,
        path: ["id"],
        value: "vip",
      });
      useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: 0,
        path: ["icon"],
        value: "GOLD_INGOT",
      });
      pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      row = (pack.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(row.id).toBe("vip");
      expect(row.icon).toBe("GOLD_INGOT");

      useAccountStore.getState().removeSourceRow({ projectId: PERSONAL, sourceId: ds0.id, index: 0 });
      pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect((pack.dataSources[0] as { rows: unknown[] }).rows).toHaveLength(0);
      expect(pack.i18nKeys[lt.key as never]).toBeUndefined();
    });

    it("assigns sequential Row keys before minting table ltexts", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useAccountStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });

      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      const rows = (useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0] as { rows: Record<string, unknown>[] }).rows;
      expect(rows.map((row) => row.id)).toEqual(["row_1", "row_2"]);
      expect((rows[1]!.lore as { key: string }).key).toBe("sources.grades.row_2.lore");
    });

    it("reuses the first available numeric Row key", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "retype", path: [], name: "id", newType: { kind: "integer" } },
      });
      useAccountStore.setState((state) =>
        produce(state, (draft) => {
          const pack = draft.account.projects.find((p) => p.id === PERSONAL)!;
          const table = pack.dataSources.find((dataSource) => dataSource.id === source.id)!;
          if (table.shape !== "table") throw new Error("expected table");
          table.rows.push({ id: 1 }, { id: 3 });
        }),
      );

      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      const rows = (useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0] as { rows: Record<string, unknown>[] }).rows;
      expect(rows.map((row) => row.id)).toEqual([1, 3, 2]);
    });

    it("rejects duplicate normalized Row keys without rekeying translations", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useAccountStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: "vip",
      });
      useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 1,
        path: ["id"],
        value: "member",
      });
      const before = structuredClone(
        useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!.i18nKeys,
      );

      const result = useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 1,
        path: ["id"],
        value: " VIP ",
      });

      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const rows = (pack.dataSources[0] as { rows: Record<string, unknown>[] }).rows;
      expect(result).toEqual({ ok: false, reason: "duplicate_row_key" });
      expect(rows[1]!.id).toBe("member");
      expect(pack.i18nKeys).toEqual(before);
    });

    it("rejects blank Row keys", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

      const result = useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: "   ",
      });

      const row = (useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(result).toEqual({ ok: false, reason: "required_row_key" });
      expect(row.id).toBe("row_1");
    });

    it("normalizes valid Row-key renames and moves all translations", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const source = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (source.shape !== "table") throw new Error("expected table");
      useAccountStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id: source.id, newName: "grades" });
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: source.modelId },
        edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
      });
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
      const oldKey = "sources.grades.row_1.lore";
      useAccountStore.setState((state) =>
        produce(state, (draft) => {
          const pack = draft.account.projects.find((p) => p.id === PERSONAL)!;
          pack.i18nKeys[oldKey as never] = { en: "VIP lore", fr: "Description VIP" };
        }),
      );

      const result = useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: source.id,
        row: 0,
        path: ["id"],
        value: " ELITE ",
      });

      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const row = (pack.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!;
      expect(result).toEqual({ ok: true });
      expect(row.id).toBe("elite");
      expect((row.lore as { key: string }).key).toBe("sources.grades.elite.lore");
      expect(pack.i18nKeys["sources.grades.elite.lore" as never]).toEqual({
        en: "VIP lore",
        fr: "Description VIP",
      });
      expect(pack.i18nKeys[oldKey as never]).toBeUndefined();
    });

    it("list items: add appends a minted element, remove releases it", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const ds0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "perks", type: { kind: "list", of: { kind: "ltext" } } } },
      });
      useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: ds0.id });
      useAccountStore.getState().addSourceListItem({ projectId: PERSONAL, sourceId: ds0.id, row: 0, path: ["perks"] });
      let pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const perks = (pack.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!.perks as {
        key: string;
      }[];
      expect(perks).toHaveLength(1);
      expect(perks[0]!.key).not.toBe("");
      const key = perks[0]!.key;
      expect(pack.i18nKeys[key as never]).toBeDefined();
      useAccountStore.getState().removeSourceListItem({ projectId: PERSONAL, sourceId: ds0.id, row: 0, path: ["perks"], index: 0 });
      pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect((pack.dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!.perks).toEqual([]);
      expect(pack.i18nKeys[key as never]).toBeUndefined();
    });

    it("config: cell set operates on the value object (row: null)", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL, shape: "config" });
      const ds0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "config", sourceId: ds0.id },
        edit: { op: "add", path: [], field: { name: "currency", type: { kind: "string" } } },
      });
      useAccountStore.getState().setSourceValue({
        projectId: PERSONAL,
        sourceId: ds0.id,
        row: null,
        path: ["currency"],
        value: "coins",
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect((pack.dataSources[0] as { value: Record<string, unknown> }).value.currency).toBe("coins");
    });

    it("editSourceField refuses a model ref that would create a cycle", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const ds0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "self", type: { kind: "model", ref: ds0.modelId } } },
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect(pack.dataModels![0]!.fields.some((f) => f.name === "self")).toBe(false);
    });

    it("renameDataModel + setModelKeyField update the model", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const ds0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!;
      if (ds0.shape !== "table") throw new Error("expected table");
      useAccountStore.getState().renameDataModel({ projectId: PERSONAL, modelId: ds0.modelId, newName: "rank" });
      useAccountStore.getState().editSourceField({
        projectId: PERSONAL,
        target: { kind: "model", modelId: ds0.modelId },
        edit: { op: "add", path: [], field: { name: "slug", type: { kind: "string" } } },
      });
      useAccountStore.getState().setModelKeyField({ projectId: PERSONAL, modelId: ds0.modelId, keyField: "slug" });
      const m = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!.dataModels![0]!;
      expect(m.name).toBe("rank");
      expect(m.keyField).toBe("slug");
    });

    it("renames a data source", () => {
      useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
      const id = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!
        .dataSources[0]!.id;
      useAccountStore
        .getState()
        .renameProjectDataSource({ projectId: PERSONAL, id, newName: "categories" });
      expect(
        useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!.dataSources[0]!
          .name,
      ).toBe("categories");
    });

  });

  it("createProject clears the temporal stack", () => {
    useAccountStore.getState().setSlotMaterial({
      projectId: projectId("p_personal"),
      menuId: menuId("m_shop_main"),
      position: 13,
      material: "EMERALD",
    });
    useAccountStore.getState().createProject({ id: "fresh_pack" });
    // pastStates should be empty after createProject clears the stack
    expect(useAccountStore.temporal.getState().pastStates.length).toBe(0);
  });

  describe("semantic i18n keys", () => {
    it("createMenu initializes title with a default vanilla (plain) layer", () => {
      const mId = useAccountStore.getState().createMenu({
        projectId: PERSONAL,
        id: "my_menu",
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const menu = pack.menus.find((m) => m.id === mId)!;
      expect(Array.isArray(menu.title)).toBe(true);
      expect(menu.title).toHaveLength(1);
      expect(menu.title[0]!.kind).toBe("plain");
      if (menu.title[0]!.kind === "plain") {
        // Empty key is the sentinel — rekeyed at deploy time or when setMenuTitle
        // is called.
        expect(menu.title[0]!.value.key).toBe("");
      }
    });

    it("setMenuTitle writes into the default plain layer (no extra layer prepended)", () => {
      const mId = useAccountStore.getState().createMenu({ projectId: PERSONAL, id: "lazy_test_menu" });
      useAccountStore.getState().setMenuTitle({ projectId: PERSONAL, menuId: mId, lang: "en", value: "Lazy" });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const menu = pack.menus.find((m) => m.id === mId)!;
      expect(menu.title).toHaveLength(1);
      const first = menu.title[0]!;
      expect(first.kind).toBe("plain");
      if (first.kind === "plain") {
        expect(first.value.key).toBe(`menus.${mId}.title`);
        expect(pack.i18nKeys[first.value.key]?.["en"]).toBe("Lazy");
      }
    });

    it("setMenuId renames i18n keys to new prefix", () => {
      const pack0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const menu0 = pack0.menus.find((m) => m.id === SHOP_MAIN)!;
      // title is now MenuTitleLayer[]; grab the first text layer's key.
      const firstLayer0 = menu0.title[0];
      expect(firstLayer0?.kind).toBe("text");
      const oldTitleKey = firstLayer0?.kind === "text" ? firstLayer0.value.key : undefined;
      expect(oldTitleKey).toBeDefined();

      useAccountStore.getState().setMenuId({ projectId: PERSONAL, oldId: SHOP_MAIN, newId: menuId("m_shop_new") });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const menu = pack.menus.find((m) => m.id === menuId("m_shop_new"))!;

      const firstLayer = menu.title[0];
      expect(firstLayer?.kind).toBe("text");
      const newTitleKey = firstLayer?.kind === "text" ? firstLayer.value.key : undefined;
      expect(newTitleKey).toBe("menus.m_shop_new.title");
      expect(pack.i18nKeys["menus.m_shop_new.title" as I18nKey]).toBeDefined();
      expect(pack.i18nKeys[oldTitleKey!]).toBeUndefined();
    });

    it("setElementId renames element i18n keys to new semantic key", () => {
      // The mock fixture already has an opaque title on PROFILE_BTN. Capture it
      // before rename, then verify rekeyMenu moved it to the semantic slot.
      const pack0 = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const el0 = pack0.menus.find((m) => m.id === SHOP_MAIN)!.layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const oldKey = el0.appearances[0]!.title?.key;
      expect(oldKey).toBeDefined(); // fixture has a title

      useAccountStore.getState().setElementId({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        oldId: PROFILE_BTN,
        newId: elementId("el_btn_new"),
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const menu = pack.menus.find((m) => m.id === SHOP_MAIN)!;
      const el = menu.layers[0]!.elements.find((e) => e.id === elementId("el_btn_new"))!;

      const expectedKey = `menus.${SHOP_MAIN}.elements.el_btn_new.default.title` as I18nKey;
      expect(el.appearances[0]!.title?.key).toBe(expectedKey);
      expect(pack.i18nKeys[expectedKey]).toBeDefined();
      expect(pack.i18nKeys[oldKey!]).toBeUndefined();
    });

    it("addElementStep allocates semantic key for send_message", () => {
      useAccountStore.getState().addElementStep({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementId: PROFILE_BTN,
        appearanceIndex: 0,
        clickType: "left",
        frames: [],
        index: -1,
        step: { kind: "action", action: { type: "send_message", text: { key: "" as I18nKey } } },
        lang: "en",
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const el = pack.menus.find((m) => m.id === SHOP_MAIN)!.layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.appearances[0]!.click!.left!.steps;
      const last = steps[steps.length - 1]!;
      if (last.kind !== "action" || last.action.type !== "send_message") throw new Error();
      const expectedPrefix = `menus.${SHOP_MAIN}.elements.${PROFILE_BTN}.default.click.left`;
      expect(last.action.text.key).toBe(`${expectedPrefix}.message`);
    });

    it("addElementStep allocates semantic keys for show_title (title + subtitle)", () => {
      useAccountStore.getState().addElementStep({
        projectId: PERSONAL,
        menuId: SHOP_MAIN,
        elementId: PROFILE_BTN,
        appearanceIndex: 0,
        clickType: "left",
        frames: [],
        index: -1,
        step: {
          kind: "action",
          action: {
            type: "show_title",
            title:    { key: "" as I18nKey },
            subtitle: { key: "" as I18nKey },
          },
        },
        lang: "en",
      });
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const el = pack.menus.find((m) => m.id === SHOP_MAIN)!.layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.appearances[0]!.click!.left!.steps;
      const last = steps[steps.length - 1]!;
      if (last.kind !== "action" || last.action.type !== "show_title") throw new Error();
      const expectedPrefix = `menus.${SHOP_MAIN}.elements.${PROFILE_BTN}.default.click.left`;
      expect(last.action.title.key).toBe(`${expectedPrefix}.show_title`);
      expect(last.action.subtitle!.key).toBe(`${expectedPrefix}.show_subtitle`);
    });

    it("addElementStep allocates distinct keys for multiple send_message steps", () => {
      const addMsg = () =>
        useAccountStore.getState().addElementStep({
          projectId: PERSONAL,
          menuId: SHOP_MAIN,
          elementId: PROFILE_BTN,
          appearanceIndex: 0,
          clickType: "left",
          frames: [],
          index: -1,
          step: { kind: "action", action: { type: "send_message", text: { key: "" as I18nKey } } },
          lang: "en",
        });

      addMsg();
      addMsg();

      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      const el = pack.menus.find((m) => m.id === SHOP_MAIN)!.layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.appearances[0]!.click!.left!.steps;
      const msgSteps = steps.filter(
        (s): s is Extract<typeof s, { kind: "action" }> =>
          s.kind === "action" && s.action.type === "send_message",
      );
      const keys = msgSteps.map((s) => (s.action as { type: "send_message"; text: { key: string } }).text.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("title layer actions", () => {
    const setupMenu = () => {
      const mId = useAccountStore.getState().createMenu({ projectId: PERSONAL, id: "tl_test_menu" });
      // createMenu seeds a default Plain (vanilla) layer; reset to empty so each
      // test starts from a clean slate.
      useAccountStore.getState().setMenuTitleLayers({ projectId: PERSONAL, menuId: mId, layers: [] });
      return mId;
    };

    const getMenu = (mId: string) => {
      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      return pack.menus.find((m) => m.id === mId)!;
    };

    it("addMenuTitleLayer appends a layer", () => {
      const mId = setupMenu();
      const layer: MenuTitleLayer = { kind: "glyph", assetId: "asset_foo" as import("@/domain/types").AssetId, x: 0, y: 0 };
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer });
      const menu = getMenu(mId);
      expect(menu.title).toHaveLength(1);
      expect(menu.title[0]!.kind).toBe("glyph");
    });

    it("removeMenuTitleLayer removes by index", () => {
      const mId = setupMenu();
      const layerA: MenuTitleLayer = { kind: "glyph", assetId: "asset_a" as import("@/domain/types").AssetId, x: 0, y: 0 };
      const layerB: MenuTitleLayer = { kind: "glyph", assetId: "asset_b" as import("@/domain/types").AssetId, x: 10, y: 0 };
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: layerA });
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: layerB });
      useAccountStore.getState().removeMenuTitleLayer({ projectId: PERSONAL, menuId: mId, index: 0 });
      const menu = getMenu(mId);
      expect(menu.title).toHaveLength(1);
      expect(menu.title[0]!.kind).toBe("glyph");
      if (menu.title[0]!.kind === "glyph") {
        expect(menu.title[0]!.assetId).toBe("asset_b");
      }
    });

    it("reorderMenuTitleLayers moves a layer", () => {
      const mId = setupMenu();
      const mkGlyph = (id: string): MenuTitleLayer => ({
        kind: "glyph",
        assetId: id as import("@/domain/types").AssetId,
        x: 0,
        y: 0,
      });
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: mkGlyph("first") });
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: mkGlyph("second") });
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer: mkGlyph("third") });
      // Move index 0 ("first") to index 2 (last).
      useAccountStore.getState().reorderMenuTitleLayers({ projectId: PERSONAL, menuId: mId, fromIndex: 0, toIndex: 2 });
      const menu = getMenu(mId);
      const ids = menu.title.map((l) => (l.kind === "glyph" ? l.assetId : "?"));
      expect(ids).toEqual(["second", "third", "first"]);
    });

    it("updateMenuTitleLayer patches a layer", () => {
      const mId = setupMenu();
      const layer: MenuTitleLayer = { kind: "glyph", assetId: "asset_orig" as import("@/domain/types").AssetId, x: 0, y: 0 };
      useAccountStore.getState().addMenuTitleLayer({ projectId: PERSONAL, menuId: mId, layer });
      useAccountStore.getState().updateMenuTitleLayer({
        projectId: PERSONAL,
        menuId: mId,
        index: 0,
        patch: { x: 42 },
      });
      const menu = getMenu(mId);
      const first = menu.title[0]!;
      expect(first.kind).toBe("glyph");
      if (first.kind === "glyph") expect(first.x).toBe(42);
    });

    it("setMenuTitleLayers replaces entire array", () => {
      const mId = setupMenu();
      useAccountStore.getState().addMenuTitleLayer({
        projectId: PERSONAL,
        menuId: mId,
        layer: { kind: "background", assetId: "bg1" as import("@/domain/types").AssetId },
      });
      const newLayers: MenuTitleLayer[] = [
        { kind: "background", assetId: "bg2" as import("@/domain/types").AssetId },
        { kind: "background", assetId: "bg3" as import("@/domain/types").AssetId },
      ];
      useAccountStore.getState().setMenuTitleLayers({ projectId: PERSONAL, menuId: mId, layers: newLayers });
      const menu = getMenu(mId);
      expect(menu.title).toHaveLength(2);
      if (menu.title[0]!.kind === "background") expect(menu.title[0]!.assetId).toBe("bg2");
      if (menu.title[1]!.kind === "background") expect(menu.title[1]!.assetId).toBe("bg3");
    });

    it("setMenuTitleLayers releases dropped text-layer i18n keys but keeps migrated ones", () => {
      const mId = setupMenu();
      const droppedKey = "lt_dropped" as I18nKey;
      const keptKey = "lt_kept" as I18nKey;
      // A text layer (dropped) and a plain layer (migrated to the new set).
      useAccountStore.getState().setMenuTitleLayers({
        projectId: PERSONAL,
        menuId: mId,
        layers: [
          { kind: "text", value: { key: droppedKey }, x: 8, y: 5 },
          { kind: "plain", value: { key: keptKey } },
        ],
      });
      // Seed translations for both so we can watch the GC.
      useAccountStore.getState().setI18nValue({ projectId: PERSONAL, lt: { key: droppedKey }, lang: "en", value: "Boutique" });
      useAccountStore.getState().setI18nValue({ projectId: PERSONAL, lt: { key: keptKey }, lang: "en", value: "Shop" });

      // Collapse to vanilla, migrating only keptKey.
      useAccountStore.getState().setMenuTitleLayers({
        projectId: PERSONAL,
        menuId: mId,
        layers: [{ kind: "plain", value: { key: keptKey } }],
      });

      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      // droppedKey is now orphaned → released; keptKey survives.
      expect(pack.i18nKeys[droppedKey]).toBeUndefined();
      expect(pack.i18nKeys[keptKey]!.en).toBe("Shop");
    });

    it("removeMenuTitleLayer GCs the removed text layer's i18n key", () => {
      const mId = setupMenu();
      const key = "lt_removed_title" as I18nKey;
      useAccountStore.getState().setMenuTitleLayers({
        projectId: PERSONAL,
        menuId: mId,
        layers: [{ kind: "text", value: { key }, x: 8, y: 5 }],
      });
      useAccountStore.getState().setI18nValue({ projectId: PERSONAL, lt: { key }, lang: "en", value: "Gone" });
      useAccountStore.getState().removeMenuTitleLayer({ projectId: PERSONAL, menuId: mId, index: 0 });

      const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
      expect(pack.i18nKeys[key]).toBeUndefined();
    });
  });

  it("applyAssistantCommand inserts then replaces a command and merges i18n", () => {
    const dropped = useAccountStore.getState().applyAssistantCommand({
      projectId: PERSONAL, lang: "en",
      commandV1: {
        schema: "command/v1", id: "heal", name: "heal",
        steps: [{ kind: "action", action: { type: "send_message", text: "Healed" } }],
      },
    });
    expect(dropped).toEqual([]);
    let pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const cmd = pack.commands.find((c) => c.id === "heal")!;
    expect(cmd.name).toBe("heal");
    const msgKey = (cmd.steps[0] as any).action.text.key;
    expect(pack.i18nKeys[msgKey]!.en).toBe("Healed");

    useAccountStore.getState().applyAssistantCommand({
      projectId: PERSONAL, lang: "en",
      commandV1: { schema: "command/v1", id: "heal", name: "heal2", steps: [{ kind: "action", action: { type: "close_menu" } }] },
    });
    pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    expect(pack.commands.filter((c) => c.id === "heal")).toHaveLength(1);
    expect(pack.commands.find((c) => c.id === "heal")!.name).toBe("heal2");
  });

  it("applyAssistantDialog inserts a dialog and merges i18n", () => {
    useAccountStore.getState().applyAssistantDialog({
      projectId: PERSONAL, lang: "en",
      dialogV1: {
        schema: "dialog/v1", id: "d_confirm", title: "Sure?",
        buttons: [{ id: "yes", label: "Yes", actions: [{ type: "close_dialog" }] }],
      },
    });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PERSONAL)!;
    const dlg = pack.dialogs.find((d) => d.id === "d_confirm")!;
    expect(dlg).toBeDefined();
    expect(pack.i18nKeys[dlg.title.key]!.en).toBe("Sure?");
    expect(dlg.buttons[0]!.steps[0]).toMatchObject({ kind: "action" });
  });
});

describe("accountStore — board membership", () => {
  const P = projectId("p_personal");

  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
  });

  it("addToBoard écrit une entrée canvasLayout sans toucher au reste du pack", () => {
    useAccountStore.getState().addToBoard({ projectId: P, nodeId: "m_about", x: 5, y: 6 });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === P)!;
    expect(pack.canvasLayout["m_about" as keyof typeof pack.canvasLayout]).toEqual({ x: 5, y: 6 });
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(true);
  });

  it("removeFromBoard retire l'entrée canvasLayout MAIS garde l'élément dans le pack", () => {
    useAccountStore.getState().addToBoard({ projectId: P, nodeId: "m_about", x: 5, y: 6 });
    useAccountStore.getState().removeFromBoard({ projectId: P, nodeId: "m_about" });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === P)!;
    expect("m_about" in pack.canvasLayout).toBe(false);
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(true);
  });

  it("arrangeAllOnBoard remplit canvasLayout pour tous les éléments via gridArrange", () => {
    useAccountStore.getState().arrangeAllOnBoard({ projectId: P });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === P)!;
    const expected = gridArrange(pack);
    expect(Object.keys(pack.canvasLayout).sort()).toEqual(Object.keys(expected).sort());
  });
});
