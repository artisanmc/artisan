import type { I18nKey, LText } from "@/domain/types";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { stepsToStructured, structuredToSteps, type ActionTextCodec } from "./structuredSteps";

/**
 * Locks the reference examples in `docs/architecture/action-steps.md` — each wire
 * blob must decode and re-encode byte-for-byte (same shape). Mirrors the doc.
 */
let values: Record<string, Record<string, string>> = {};
let counter = 0;
const codec: ActionTextCodec = {
  // Mirror `fieldTextOf`: a single-language text collapses to its bare string.
  toWire: (key) => {
    const v = values[key] ?? {};
    const langs = Object.keys(v);
    return langs.length <= 1 ? (v[langs[0]!] ?? "") : v;
  },
  fromWire: (raw) => {
    const key = `k${counter++}` as I18nKey;
    values[key] = typeof raw === "string" ? { en: raw } : raw;
    return { key } as LText;
  },
};

const roundTrip = (wire: unknown) => stepsToStructured(structuredToSteps(wire, codec), codec);

const ACTIONS = `
- send_message: "Bienvenue !"
- give_money: 100
- run_command: "say hi"
- run_command: { command: "op", as: console }
- open_menu: shop_category
- open_menu: { menu_id: shop, context: { cat: "{cat.id}" } }
- close_menu
- close_dialog
`;

const IF_BLOCK = `
- if:
    - has_permission: shop.vip
    - or:
        - world_is: world_nether
        - time_is: night
  do:
    - send_message: { en: "Access granted", fr: "Accès accordé" }
  else:
    - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
`;

const FULL = `
elements:
  - id: shop
    positions: 13
    material: PAPER
    title: { en: "Shop", fr: "Boutique" }
    click:
      left:
        - if:
            - has_permission: shop.vip
            - or:
                - placeholder_match: { placeholder: "%server_type%", regex: "^premium" }
                - world_is: world_nether
          do:
            - show_title: { title: { en: "VIP", fr: "VIP" }, subtitle: "§7Welcome" }
            - send_message: { en: "Access granted", fr: "Accès accordé" }
          else:
            - if:
                - random_chance: 0.1
              do:
                - open_dialog: lucky_draw
              else:
                - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
`;

describe("action-steps doc examples", () => {
  it("actions list round-trips", () => {
    const wire = parse(ACTIONS);
    expect(roundTrip(wire)).toEqual(wire);
  });

  it("if/else block round-trips", () => {
    const wire = parse(IF_BLOCK);
    expect(roundTrip(wire)).toEqual(wire);
  });

  it("full element example round-trips", () => {
    const menu = parse(FULL) as { elements: { click: { left: unknown } }[] };
    const wire = menu.elements[0]!.click.left;
    expect(roundTrip(wire)).toEqual(wire);
  });

  it("tolerant read: a legacy DSL string decodes to at least one step", () => {
    const steps = structuredToSteps("close_menu", codec);
    expect(steps).toHaveLength(1);
  });
});
