import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import type { AssetRow } from "./fontJsonBuilder";
import { ImageNames, namedImageRow, resolveImageRef } from "./imageNames";

interface Vector {
  modules: { folder: string; fonts: string[]; images: string[] }[];
  ids: Record<string, Record<string, string>>;
  also: string[];
  cases: { from: string | null; ref: string; expect: string }[];
}

const vector: Vector = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../testdata/image-ref-conformance.json"), "utf8"),
);

function names(): ImageNames {
  const out = new ImageNames();
  for (const module of vector.modules) {
    for (const font of module.fonts) out.take(font);
    for (const image of module.images)
      expect(out.claim(module.folder, image), `${module.folder}/${image}`).toBe(
        vector.ids[module.folder]![image],
      );
  }
  return out;
}

test("the first module keeps the bare name, a later one is qualified", () => {
  // Asking twice (a glyph and a texture of one name in a module) gives the same id.
  expect(names().claim("guilds", "gold")).toBe("guilds:gold");
});

test("a name reaches the id the shared cases say", () => {
  const built = names();
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
