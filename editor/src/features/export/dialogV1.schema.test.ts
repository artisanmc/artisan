import dialogSchema from "../../../../docs/schema/dialog/v1/schema.json";
import { dialogId, menuId, projectId } from "@/domain/ids";
import type { Dialog, I18nKey, Project } from "@/domain/types";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { transform } from "./transform";

/**
 * Fixture oracle for the published dialog/v1 schema: what the editor exports
 * (transform → dialogs/<id>.yaml) must validate against docs/schema/dialog/v1.
 */

const PACK = projectId("p_dialog");

function lt(pack: Project, value: string): { key: I18nKey } {
  const key = `lt_${Object.keys(pack.i18nKeys).length}` as I18nKey;
  pack.i18nKeys[key] = { en: value };
  return { key };
}

function buildProject(): Project {
  const pack: Project = {
    id: PACK,
    name: "Dialog fixture",
    source: "user_created",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    menus: [],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };

  const dialog: Dialog = {
    id: dialogId("confirm_purchase"),
    projectId: PACK,
    title: lt(pack, "Confirm purchase"),
    canCloseWithEscape: false,
    body: [
      { type: "text", text: lt(pack, "Are you sure?") },
      { type: "item", material: "DIAMOND", count: 1 },
    ],
    inputs: [
      { type: "text", id: "note", label: lt(pack, "Note"), default: "", maxLength: 32 },
      { type: "bool", id: "gift", label: lt(pack, "Gift wrap"), default: false },
      { type: "number_range", id: "qty", label: lt(pack, "Quantity"), min: 1, max: 64, default: 1 },
      {
        type: "single_option",
        id: "currency",
        label: lt(pack, "Currency"),
        options: [
          { value: "coins", label: lt(pack, "Coins") },
          { value: "gems", label: lt(pack, "Gems") },
        ],
        default: "coins",
      },
    ],
    buttons: [
      {
        id: "buy",
        label: lt(pack, "Buy"),
        steps: [
          { kind: "action", action: { type: "take_money", amount: 100 } },
          { kind: "action", action: { type: "close_dialog" } },
        ],
      },
      {
        id: "cancel",
        label: lt(pack, "Cancel"),
        steps: [{ kind: "action", action: { type: "open_menu", menuId: menuId("shop") } }],
      },
    ],
  };
  pack.dialogs.push(dialog);
  return pack;
}

describe("dialog/v1 schema fixture", () => {
  it("the editor's exported dialog YAML validates against docs/schema/dialog/v1", () => {
    const pack = buildProject();
    const files = transform(pack);
    const yaml = files[`plugins/Artisan/projects/${PACK}/dialogs/confirm_purchase.yaml`];
    expect(yaml).toBeTruthy();
    const wire = parse(yaml!) as Record<string, unknown>;

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(dialogSchema);
    const ok = validate(wire);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
