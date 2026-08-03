import { visitMenuLTexts, visitStepLTexts } from "@/domain/i18nSites";
import { menuId, projectId } from "@/domain/ids";
import type { I18nKey, Menu, MenuTitleLayer, Step } from "@/domain/types";
import { parseToSteps } from "@/lib/actionDsl";
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

describe("i18n address conformance — action texts", () => {
  for (const c of vector.step_addresses) {
    it(c.name, () => {
      const steps = parseToSteps(c.dsl) as Step[];
      expect([...visitStepLTexts(steps, c.prefix)].map((s) => s.key)).toEqual(c.addresses);
    });
  }
});
