import { describe, expect, it } from "vitest";
import { imageMarks, imageStanding } from "./imageStanding";

const index =
  "files:\n" +
  "  assets/textures/crest.png: { module: guilds, template: system, version: 1, hash: aaa }\n" +
  "  assets/textures/flag.png: { module: guilds, template: system, version: 1, hash: bbb }\n";
const files = { "artisan-shipped.yml": index };
const binaries = {
  "assets/textures/crest.png": { hash: "aaa" },
  "assets/textures/flag.png": { hash: "zzz" },
  "assets/textures/mine.png": { hash: "ccc" },
};
const parsed = {
  "assets/textures/crest.png": { module: "guilds", template: "system", version: 1, hash: "aaa" },
  "assets/textures/flag.png": { module: "guilds", template: "system", version: 1, hash: "bbb" },
};

describe("a module's images in the tree layout (ADR editable-module-tree)", () => {
  it("an untouched image is as shipped, a changed one stands over the module's version", () => {
    const at = (id: string) => imageStanding(binaries, { id, type: "texture" }, [], parsed);
    expect(at("crest")).toEqual({ own: "assets/textures/crest.png", asShipped: true });
    expect(at("flag")).toEqual({
      own: "assets/textures/flag.png",
      original: {
        path: "assets/textures/flag.png",
        hash: "bbb",
        shipped: { module: "guilds", template: "system" },
      },
    });
    expect(at("mine")).toEqual({ own: "assets/textures/mine.png" });
  });

  it("marks the owner's version, and an update the file did not take", () => {
    expect(imageMarks(files, binaries).get("assets/textures/flag")).toBe("own_version");
    expect(imageMarks(files, binaries).has("assets/textures/crest")).toBe(false);
    const origins = {
      "assets/textures/flag.png": { module: "guilds", template: "system", version: 1, hash: "bbb" },
      "originals/assets/textures/flag.png": {
        module: "guilds",
        template: "system",
        version: 2,
        hash: "ddd",
      },
    };
    expect(imageMarks(files, binaries, origins).get("assets/textures/flag")).toBe(
      "original_changed",
    );
  });
});
