import { describe, expect, it } from "vitest";
import { keepEquivalentText, sameYamlValue } from "./yamlEquivalence";

const SHIPPED = [
  "schema: conversation_theme/v1",
  'title: { fr: "Taverne", en: "Tavern" }',
  "chat:",
  '  line: "<#f4f0dc>"',
  "  sounds: { line: entity.villager.ambient }",
  "",
].join("\r\n");

const CANONICAL = `schema: conversation_theme/v1
title:
  fr: Taverne
  en: Tavern
chat:
  line: <#f4f0dc>
  sounds:
    line: entity.villager.ambient
`;

describe("sameYamlValue", () => {
  it("ignores the style, the quotes, the key order and CRLF", () => {
    expect(sameYamlValue(SHIPPED, CANONICAL)).toBe(true);
    expect(sameYamlValue("a: 1\nb: 2\n", "b: 2\na: 1\n")).toBe(true);
    expect(sameYamlValue('levels: { "2": x }', "levels:\n  2: x\n")).toBe(true);
  });

  it("sees a changed value, and never trusts unreadable YAML", () => {
    expect(sameYamlValue(SHIPPED, CANONICAL.replace("Tavern", "Inn"))).toBe(false);
    expect(sameYamlValue("a: [1, 2]", "a: [2, 1]")).toBe(false);
    expect(sameYamlValue("a: 1", "a: '1'")).toBe(false);
    expect(sameYamlValue("a: [", "a: [")).toBe(true);
    expect(sameYamlValue("a: [", "a: ]")).toBe(false);
  });
});

describe("keepEquivalentText", () => {
  it("gives back the disk's text for a file the editor did not change", () => {
    const disk = { "conversation_themes/taverne.yml": SHIPPED, "menus/shop.yml": "title: Shop\n" };
    const tree = {
      "conversation_themes/taverne.yml": CANONICAL,
      "menus/shop.yml": "title: Store\n",
      "menus/new.yml": "x: 1\n",
    };
    expect(keepEquivalentText(tree, disk)).toEqual({
      "conversation_themes/taverne.yml": SHIPPED,
      "menus/shop.yml": "title: Store\n",
      "menus/new.yml": "x: 1\n",
    });
  });

  it("writes an edited file as the disk's text with the edit, in its CRLF", () => {
    const disk = { "conversation_themes/taverne.yml": SHIPPED };
    const edited = CANONICAL.replace("en: Tavern", "en: Inn");
    expect(keepEquivalentText({ "conversation_themes/taverne.yml": edited }, disk)).toEqual({
      "conversation_themes/taverne.yml": SHIPPED.replace('"Tavern"', '"Inn"'),
    });
    expect(keepEquivalentText({ "a.yml": "a: [2\n" }, { "a.yml": "a: [\r\n" })).toEqual({
      "a.yml": "a: [2\r\n",
    });
    expect(keepEquivalentText({ "a.yml": "a: 2\n" }, { "a.yml": "a: 1\n" })).toEqual({
      "a.yml": "a: 2\n",
    });
  });

  it("leaves the tree alone without a disk, and keeps other files as written", () => {
    const tree = { "a.yml": "a: 1\n" };
    expect(keepEquivalentText(tree, undefined)).toBe(tree);
    expect(keepEquivalentText({ "notes.txt": "a" }, { "notes.txt": "a\r\n" })).toEqual({
      "notes.txt": "a",
    });
  });
});
