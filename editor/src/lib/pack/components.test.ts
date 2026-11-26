// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { componentFiles, packComponents } from "./components";
import { KIT_SLOTS } from "./kit";

const DIR = resolve(__dirname, "../../assets/kit");
const listed = JSON.parse(readFileSync(resolve(DIR, "components.json"), "utf8")) as string[];
/** The base's components as the server writes them in the theme `artisan`. */
const shipped = listed.map((name) => ({
  path: `originals/components/${name}.yml`,
  content: readFileSync(resolve(DIR, "components", `${name}.yml`), "utf8"),
}));

const menu = {
  id: "m",
  size: 27,
  elements: [{ id: "ok", positions: "0-2", component: "confirm" }],
};
const parts = (theme: { path: string; content: string }[]) => {
  const expand = packComponents([
    { folder: "shop", files: [] },
    { folder: "artisan", files: theme },
  ]);
  return (expand("shop")(menu) as typeof menu & { elements: { parts?: unknown }[] }).elements[0]
    ?.parts;
};

describe("the components Artisan ships", () => {
  test("the list the plugin reads names every file of the folder", () => {
    const files = readdirSync(resolve(DIR, "components")).map((f) => f.replace(/\.yml$/, ""));
    expect([...listed].sort()).toEqual(files.sort());
  });

  test("each reads, and draws images of the base only", () => {
    const read = componentFiles([{ folder: "artisan", files: shipped }]).get("artisan");
    expect([...(read?.keys() ?? [])].sort()).toEqual([...listed].sort());
    const base = new Set(KIT_SLOTS.map((slot) => slot.id));
    for (const [name, file] of read ?? []) {
      const { params = {}, parts } = file as {
        params?: Record<string, { default?: unknown }>;
        parts: { image?: string }[];
      };
      expect(parts.length, name).toBeGreaterThan(0);
      for (const part of parts) {
        if (part.image === undefined) continue;
        const param = /^\{([a-z][a-z0-9_]*)\}$/.exec(part.image)?.[1];
        const drawn = param ? params[param]?.default : part.image;
        expect(base.has(String(drawn)), `${name} draws ${String(drawn)}`).toBe(true);
      }
    }
  });

  test("a menu names one, and the server's own of that name replaces it", () => {
    expect(parts(shipped)).toEqual([
      { image: "artisan:button.3x1" },
      { label: { en: "Confirm", fr: "Confirmer" } },
    ]);
    const own = { path: "components/confirm.yml", content: "parts:\n  - image: my_button\n" };
    expect(parts([...shipped, own])).toEqual([{ image: "artisan:my_button" }]);
  });
});
