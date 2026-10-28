import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { patchYamlText } from "./yamlPatch";

const DIALOG = `schema: dialog/v1
# Shipped by ArtisanAuctions
title: { en: "Confirm the purchase", fr: "Confirmer l'achat" }
can_close_with_escape: true
buttons:
  - id: confirm
    label: { en: "<green>Buy", fr: "<green>Acheter" }
    actions:
      - run_command: "auctions:buy {id}"
      - open_previous_menu
  - id: cancel
    label: { en: "Cancel", fr: "Annuler" }
    actions: [ open_previous_menu ]
`;

interface Dialog {
  title: Record<string, string>;
  can_close_with_escape?: boolean;
  buttons: [Button, Button, ...Partial<Button>[]];
}
interface Button {
  id: string;
  label: Record<string, string>;
  actions: unknown[];
}

/** `DIALOG`'s value with [edit] applied, written as the editor writes it. */
function edited(edit: (value: Dialog) => void): string {
  const value = parse(DIALOG) as Dialog;
  edit(value);
  return JSON.stringify(value);
}

describe("patchYamlText", () => {
  it("rewrites only the changed value, in the file's own style", () => {
    const out = patchYamlText(
      DIALOG,
      edited((v) => {
        v.buttons[0].label.fr = "<green>Payer";
      }),
    );
    expect(out).toBe(DIALOG.replace('"<green>Acheter"', '"<green>Payer"'));
  });

  it("adds, removes and reorders nothing but what changed", () => {
    const out = patchYamlText(
      DIALOG,
      edited((v) => {
        v.title.de = "Kauf bestätigen";
        v.can_close_with_escape = undefined;
        v.buttons[1].actions.push("close");
        v.buttons.push({ id: "more", actions: [] });
      }),
    );
    expect(out).toContain(
      'title: { en: "Confirm the purchase", fr: "Confirmer l\'achat", de: Kauf bestätigen }',
    );
    expect(out).toContain("# Shipped by ArtisanAuctions");
    expect(out).toContain("actions: [ open_previous_menu, close ]");
    expect(out).not.toContain("can_close_with_escape");
    expect(parse(out ?? "").buttons[2]).toEqual({ id: "more", actions: [] });
  });

  it("keeps numbered keys and changes a value's type", () => {
    const disk = "levels:\n  2: { cost: 10 } # two\n  3: { cost: 20 }\n";
    const out = patchYamlText(disk, '{"levels":{"2":{"cost":15},"3":"x"}}');
    expect(out).toBe("levels:\n  2: { cost: 15 } # two\n  3: x\n");
  });

  it("gives up on a file it cannot patch", () => {
    expect(patchYamlText("a: [", "a: 1")).toBeNull();
    expect(patchYamlText("just text", "a: 1")).toBeNull();
  });
});
