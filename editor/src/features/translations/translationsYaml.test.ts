import type { I18nKey } from "@/domain/types";
import type { TranslationRow } from "@/lib/i18nUsages";
import { flattenLangTree } from "@/lib/langTree";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { countListLeaves, serializeRows } from "./translationsYaml";

const TEXTS = { header: "Traductions : fr → en", subtitle: "Modifiez puis Appliquer." };

const row = (over: {
  key: string;
  context?: string;
  source?: string;
  target?: string;
}): TranslationRow => ({
  key: over.key as I18nKey,
  context: over.context ?? over.key,
  source: over.source ?? "",
  target: over.target ?? "",
});

const serialize = (rows: TranslationRow[], activeLang = "fr", includeContext = true) =>
  serializeRows(rows, "fr", activeLang, includeContext, TEXTS);

describe("serializeRows", () => {
  it("emits a nested tree, like the lang file on disk", () => {
    const out = serialize([
      row({ key: "menus.shop_main.title", target: "Boutique" }),
      row({ key: "menus.shop_main.elements.back.default.title", target: "<gray>Retour" }),
    ]);
    expect(out).toContain("menus:\n");
    expect(out).not.toMatch(/^menus\./m);
    expect(parse(out)).toEqual({
      menus: {
        shop_main: {
          elements: { back: { default: { title: "<gray>Retour" } } },
          title: "Boutique",
        },
      },
    });
  });

  it("drops the context comment when it only repeats the key", () => {
    const out = serialize([row({ key: "menus.shop_main.title", target: "Boutique" })]);
    expect(out).not.toContain("menus.shop_main.title");
  });

  it("keeps a context comment that says something the key does not", () => {
    const out = serialize([
      row({ key: "item_templates.tpl_1.title", context: "set « Armes » · title", target: "x" }),
      row({ key: "menus.dead.title", context: "(unused)", target: "y" }),
    ]);
    expect(out).toContain("# set « Armes » · title");
    expect(out).toContain("# (unused)");
  });

  it("shows the default-language source when translating another language, newlines escaped", () => {
    const out = serialize(
      [row({ key: "menus.m.lore", source: "ligne1\nligne2", target: "" })],
      "en",
    );
    expect(out).toContain("# fr: ligne1\\nligne2");
  });

  it("omits the source line when the active language IS the default", () => {
    const out = serialize([row({ key: "menus.m.title", source: "Boutique", target: "Boutique" })]);
    expect(out).not.toContain("# fr:");
  });

  it("respects the context-comments toggle but keeps the source line", () => {
    const out = serialize(
      [row({ key: "menus.m.title", context: "(unused)", source: "S", target: "T" })],
      "en",
      false,
    );
    expect(out).not.toContain("(unused)");
    expect(out).toContain("# fr: S");
  });

  it("carries the header as leading comments", () => {
    const out = serialize([row({ key: "a.b", target: "x" })]);
    expect(out.startsWith(`# ${TEXTS.header}\n# ${TEXTS.subtitle}\n`)).toBe(true);
  });

  it("keeps a key blocked by a leaf addressable, with its comment", () => {
    const out = serialize([
      row({ key: "a.b", target: "leaf" }),
      row({ key: "a.b.c", context: "(unused)", target: "deeper" }),
    ]);
    expect(flattenLangTree(parse(out))).toEqual({ "a.b": "leaf", "a.b.c": "deeper" });
    expect(out).toContain("# (unused)");
  });

  it("round-trips: an untouched draft flattens back to exactly the rows", () => {
    const rows = [
      row({ key: "menus.shop.title", target: "Boutique" }),
      row({ key: "menus.shop.elements.item:ci_ab12.default.lore", target: "zzza" }),
      row({ key: "sources.categories.weapons.name", target: "" }),
      row({ key: "menus.m.lore", target: "l1\nl2" }),
    ];
    expect(flattenLangTree(parse(serialize(rows)))).toEqual({
      "menus.shop.title": "Boutique",
      "menus.shop.elements.item:ci_ab12.default.lore": "zzza",
      "sources.categories.weapons.name": "",
      "menus.m.lore": "l1\nl2",
    });
  });
});

describe("countListLeaves", () => {
  it("counts list values, which cannot become a translation", () => {
    expect(countListLeaves({ a: { b: ["x"], c: "ok" }, d: ["y", "z"] })).toBe(2);
    expect(countListLeaves({ a: { b: "ok" } })).toBe(0);
    expect(countListLeaves(null)).toBe(0);
  });
});
