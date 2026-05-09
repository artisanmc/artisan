import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { renderCustomIconsWithPaths } from "./customItemRenderer";

const TMP_CACHE = join(import.meta.dir, "../../data/custom-items/__renderer_test__");
const TMP_VANILLA = join(import.meta.dir, "../../data/custom-items/__vanilla_test__");

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
  "base64"
);

beforeEach(() => {
  mkdirSync(join(TMP_CACHE, "textures/nexo"), { recursive: true });
  mkdirSync(join(TMP_CACHE, "models/nexo"), { recursive: true });
  mkdirSync(join(TMP_VANILLA, "models/item"), { recursive: true });
  mkdirSync(join(TMP_VANILLA, "models/block"), { recursive: true });
  mkdirSync(join(TMP_VANILLA, "textures/block"), { recursive: true });
});
afterEach(() => {
  rmSync(TMP_CACHE, { recursive: true, force: true });
  rmSync(TMP_VANILLA, { recursive: true, force: true });
});

describe("renderCustomIconsWithPaths", () => {
  test("no-op when items.json missing", async () => {
    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);
  });

  test("skips item with no model file — no icon created, texture unchanged", async () => {
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }])
    );
    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);
    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__coin.png"))).toBe(false);
    const items = JSON.parse(readFileSync(join(TMP_CACHE, "items.json"), "utf-8"));
    expect(items[0].texture).toBe("nexo/coin");
  });

  test("flat item (item/generated parent) — no icon, texture unchanged", async () => {
    writeFileSync(
      join(TMP_VANILLA, "models/item/generated.json"),
      JSON.stringify({ display: {} })
    );
    writeFileSync(
      join(TMP_CACHE, "models/nexo/coin.json"),
      JSON.stringify({ parent: "item/generated", textures: { layer0: "nexo:item/coin" } })
    );
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }])
    );

    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);

    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__coin.png"))).toBe(false);
    const items = JSON.parse(readFileSync(join(TMP_CACHE, "items.json"), "utf-8"));
    expect(items[0].texture).toBe("nexo/coin");
  });

  test("unknown custom parent chain — flat fallthrough, no crash", async () => {
    writeFileSync(
      join(TMP_CACHE, "models/nexo/widget.json"),
      JSON.stringify({ parent: "nexo:item/widget_base", textures: { layer0: "nexo:item/widget" } })
    );
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:widget", label: "Widget", category: "nexo", texture: "nexo/widget" }])
    );

    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);
    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__widget.png"))).toBe(false);
  });

  test("cube block model — icon written to textures/icons/, items.json texture updated", async () => {
    writeFileSync(
      join(TMP_VANILLA, "models/block/cube_all.json"),
      JSON.stringify({
        elements: [{
          from: [0, 0, 0], to: [16, 16, 16],
          faces: {
            up:    { texture: "#all", uv: [0, 0, 16, 16] },
            west:  { texture: "#all", uv: [0, 0, 16, 16] },
            south: { texture: "#all", uv: [0, 0, 16, 16] },
          },
        }],
      })
    );
    writeFileSync(join(TMP_VANILLA, "textures/block/stone.png"), PLACEHOLDER_PNG);
    writeFileSync(
      join(TMP_CACHE, "models/nexo/stone_block.json"),
      JSON.stringify({ parent: "block/cube_all", textures: { all: "block/stone" } })
    );
    writeFileSync(join(TMP_CACHE, "textures/nexo/stone_block.png"), PLACEHOLDER_PNG);
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:stone_block", label: "Stone Block", category: "nexo", texture: "nexo/stone_block" }])
    );

    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);

    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__stone_block.png"))).toBe(true);
    const items = JSON.parse(readFileSync(join(TMP_CACHE, "items.json"), "utf-8"));
    expect(items[0].texture).toBe("icons/nexo__stone_block");
  });
});
