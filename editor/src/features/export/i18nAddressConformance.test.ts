import { adoptActionTexts, visitMenuLTexts, visitStepLTexts } from "@/domain/i18nSites";
import { menuId, projectId } from "@/domain/ids";
import type { I18nKey, Menu, MenuTitleLayer, ModelField, Project, Step } from "@/domain/types";
import { parseToSteps } from "@/lib/actionDsl";
import { coreActionOf } from "@/lib/actions/coreActions";
import { structuredToSteps } from "@/lib/actions/structuredSteps";
import type { DeclaredAction } from "@/lib/api/declaredActions";
import {
  clickHandlerKeyPrefix,
  commandKeyPrefix,
  dialogBodyTextKey,
  dialogButtonKeyPrefix,
  dialogButtonLabelKey,
  dialogInputLabelKey,
  dialogOptionLabelKey,
  dialogTitleKey,
  elementLoreKey,
  elementTitleKey,
  menuTitleKey,
  stateLabel,
} from "@/lib/i18nKeys";
import { describe, expect, it } from "vitest";
import vector from "../../../../testdata/i18n-address-conformance.json";

/**
 * Editor half of the i18n address contract — the plugin's
 * `I18nAddressConformanceTest` asserts the very same vector. Both must agree
 * exactly: the editor writes `lang/<lang>.yaml` at these addresses, the plugin
 * looks them up there.
 */

type Site = (typeof vector.sites)[number] & Record<string, string | number>;

const addressOf = (s: Site): string => {
  const menu = String(s.menu_id);
  const element = String(s.element_id);
  const app = Number(s.appearance_index);
  const dialog = String(s.dialog_id);
  switch (s.kind) {
    case "menu_title": {
      const base = menuTitleKey(menu);
      const i = Number(s.layer_index);
      return i === 0 ? base : `${base}_${i + 1}`;
    }
    case "appearance":
      return `menus.${menu}.elements.${element}.${stateLabel(app)}`;
    case "appearance_title":
      return elementTitleKey(menu, element, app);
    case "appearance_lore":
      return elementLoreKey(menu, element, app);
    case "click_prefix":
      return clickHandlerKeyPrefix(menu, element, app, String(s.click_type));
    case "command_prefix":
      return commandKeyPrefix(String(s.command_id));
    case "dialog_title":
      return dialogTitleKey(dialog);
    case "dialog_body":
      return dialogBodyTextKey(dialog, Number(s.body_index));
    case "dialog_input_label":
      return dialogInputLabelKey(dialog, String(s.input_id));
    case "dialog_option_label":
      return dialogOptionLabelKey(dialog, String(s.input_id), String(s.option_value));
    case "dialog_button_label":
      return dialogButtonLabelKey(dialog, String(s.button_id));
    case "dialog_button_prefix":
      return dialogButtonKeyPrefix(dialog, String(s.button_id));
    default:
      throw new Error(`unknown site kind: ${s.kind}`);
  }
};

describe("i18n address conformance — key sites", () => {
  for (const site of vector.sites as Site[]) {
    it(site.name, () => {
      expect(addressOf(site)).toBe(site.address);
    });
  }
});

/** Vector layer descriptor → the domain title layer it stands for. */
const titleLayer = (l: Record<string, unknown>): MenuTitleLayer => {
  const value = { key: String(l.value ?? "") as I18nKey };
  switch (l.kind) {
    case "background":
      return { kind: "background", assetId: String(l.asset_id) } as MenuTitleLayer;
    case "glyph":
      return {
        kind: "glyph",
        assetId: String(l.asset_id),
        x: Number(l.x),
        y: Number(l.y),
      } as MenuTitleLayer;
    case "plain":
      return { kind: "plain", value } as MenuTitleLayer;
    case "textarea":
      return {
        kind: "textarea",
        value,
        x: Number(l.x),
        y: Number(l.y),
        width: 168,
        lineHeight: 10,
        alignment: "left",
      } as MenuTitleLayer;
    default:
      return { kind: "text", value, x: Number(l.x), y: Number(l.y) } as MenuTitleLayer;
  }
};

describe("i18n address conformance — menu title layers", () => {
  for (const c of vector.menu_titles) {
    it(c.name, () => {
      const menu = {
        id: menuId(c.menu_id),
        projectId: projectId("p"),
        rows: 3,
        title: c.layers.map((l) => titleLayer(l as Record<string, unknown>)),
        layers: [],
      } as unknown as Menu;
      expect([...visitMenuLTexts(menu)].map((s) => s.key)).toEqual(c.addresses);
    });
  }
});

/**
 * A `step_addresses` case: a legacy `dsl` chain, or keyed `steps` (the structured wire,
 * module actions included) with the `declared_actions` of the module actions it uses.
 */
interface StepCase {
  name: string;
  prefix: string;
  dsl?: string;
  steps?: unknown;
  declared_actions?: {
    name: string;
    args: ModelField[];
    primary?: string | null;
    module_id?: string | null;
  }[];
  addresses: string[];
}

describe("i18n address conformance — action texts", () => {
  for (const c of vector.step_addresses as StepCase[]) {
    it(c.name, () => {
      const declared: DeclaredAction[] = (c.declared_actions ?? []).map((d) => ({
        name: d.name,
        args: d.args,
        primary: d.primary ?? null,
        moduleId: d.module_id ?? null,
      }));
      const declOf = (name: string) => coreActionOf(name) ?? declared.find((a) => a.name === name);
      // The wire texts are adopted into LText nodes at their address first, as the
      // editor does once the declarations are known; the visitor then yields the sites.
      const project = { defaultLang: "en", i18nKeys: {} } as unknown as Project;
      const steps =
        c.dsl !== undefined
          ? (parseToSteps(c.dsl) as Step[])
          : structuredToSteps(c.steps, {
              toWire: () => "",
              fromWire: (raw) => {
                const key = `k_${Object.keys(project.i18nKeys).length}` as I18nKey;
                project.i18nKeys[key] = typeof raw === "string" ? { en: raw } : raw;
                return { key };
              },
            });
      adoptActionTexts(project, steps, c.prefix, declOf);
      expect([...visitStepLTexts(steps, c.prefix, declOf)].map((s) => s.key)).toEqual(c.addresses);
    });
  }

  it("adopts a module text's languages under its address", () => {
    const declared: DeclaredAction = {
      name: "quests:notify",
      args: [{ name: "text", type: { kind: "ltext" }, required: true }],
      primary: "text",
      moduleId: "quests",
    };
    const declOf = (name: string) => coreActionOf(name) ?? (name === declared.name ? declared : undefined);
    const project = { defaultLang: "en", i18nKeys: {} } as unknown as Project;
    const steps = structuredToSteps([{ "quests:notify": { en: "Hi", fr: "Salut" } }, { "quests:notify": "Bye" }], {
      toWire: () => "",
      fromWire: () => ({ key: "" as I18nKey }),
    });
    adoptActionTexts(project, steps, "commands.give", declOf);
    expect(project.i18nKeys).toEqual({
      "commands.give.quests.notify.text": { en: "Hi", fr: "Salut" },
      "commands.give.quests.notify_1.text": { en: "Bye" },
    });
    const first = steps[0];
    expect(first?.kind === "action" && first.action.type === "module" ? first.action.value : null).toEqual({
      key: "commands.give.quests.notify.text",
    });
  });
});
