import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import type { AssetRow } from "./fontJsonBuilder";
import { ImageNames, namedImageRow, resolveImageRef, themeImagePath } from "./imageNames";

interface Vector {
  common: string[];
  modules: { folder: string; fonts: string[]; images: string[] }[];
  ids: Record<string, Record<string, string>>;
  themes: { folder: string; images: string[] }[];
  also: string[];
  cases: { from: string | null; ref: string; expect: string }[];
}

const vector: Vector = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../testdata/image-ref-conformance.json"), "utf8"),
);

function names(): ImageNames {
  const out = new ImageNames();
  for (const name of vector.common) out.common(name);
  for (const module of vector.modules) {
    for (const font of module.fonts) out.take(font);
    for (const image of module.images)
      expect(out.claim(module.folder, image), `${module.folder}/${image}`).toBe(
        vector.ids[module.folder]![image],
      );
  }
  return out;
}

test("the first module keeps the bare name, a later one is qualified, and one that shares a common image's name", () => {
  const built = names();
  // Asking twice (a glyph and a texture of one name in a module) gives the same id.
  expect(built.claim("guilds", "gold")).toBe("guilds:gold");
  // No common image is named `gold`: the first module's is the bare id. One is named `panel`.
  expect(built.claim("core", "gold")).toBe("gold");
  expect(built.claim("core", "panel")).toBe("core:panel");
});

test("a theme's own image is `<theme>:<name>`, once, and none for a reserved folder", () => {
  const built = names();
  for (const theme of vector.themes)
    for (const image of theme.images) {
      expect(built.themeOwn(theme.folder, image)).toBe(`${theme.folder}:${image}`);
      // Asked twice (a glyph and a texture of one name): the first one keeps the id.
      expect(built.themeOwn(theme.folder, image)).toBeNull();
    }
  // `guilds:gold` is the module's image: a theme of that folder gives none.
  expect(built.themeOwn("guilds", "gold")).toBeNull();
  // `artisan:<name>` and `kit:<name>` name the common images.
  expect(built.themeOwn("artisan", "star")).toBeNull();
  expect(built.themeOwn("kit", "star")).toBeNull();
  expect(themeImagePath("noel", "star")).toBe("themes/noel/star");
});

test("a name reaches the id the shared cases say", () => {
  const built = names();
  for (const theme of vector.themes)
    for (const image of theme.images) built.themeOwn(theme.folder, image);
  for (const id of vector.also) built.take(id);
  for (const c of vector.cases)
    expect(built.resolve(c.from ?? "", c.ref), `ref=${c.ref} from=${c.from}`).toBe(c.expect);
});

test("the ids alone give the same answer: what the plugin reads from the asset index", () => {
  const ids = new Set<string>(vector.also);
  for (const module of vector.modules) for (const font of module.fonts) ids.add(font);
  for (const images of Object.values(vector.ids))
    for (const id of Object.values(images)) ids.add(id);
  for (const c of vector.cases)
    expect(
      resolveImageRef((id) => ids.has(id), c.from ?? "", c.ref),
      `ref=${c.ref} from=${c.from}`,
    ).toBe(c.expect);
});

test("a qualified image has its files under its module", () => {
  const row = { id: "gold", name: "gold", type: "texture" } as AssetRow;
  expect(namedImageRow(row, "gold", "guilds")).toBe(row);
  expect(namedImageRow(row, "guilds:gold", "guilds")).toMatchObject({
    id: "guilds:gold",
    name: "modules/guilds/gold",
  });
});
