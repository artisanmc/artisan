import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ActiveModule } from "@/lib/api/modules";
import { builtInBrand, moduleBrand, themed } from "@/lib/moduleBrand";
import { describe, expect, it } from "vitest";

const auctions: ActiveModule = {
  id: "auctions",
  version: "1.0",
  brand: {
    hash: "h1",
    files: ["icon", "logo-dark", "wordmark-dark"],
    logo: { width: 85, height: 8 },
  },
};

describe("moduleBrand", () => {
  it("serves what the module's jar announces, from its server, pinned to its hash", () => {
    const brand = moduleBrand("auctions", "srv", [auctions]);
    expect(brand?.icon).toBe("/api/v1/servers/srv/modules/auctions/brand/icon.svg?v=h1");
    expect(brand?.logo).toEqual({
      dark: "/api/v1/servers/srv/modules/auctions/brand/logo-dark.svg?v=h1",
      light: undefined,
      width: 85,
      height: 8,
    });
    // A single logo serves both themes.
    expect(themed(brand?.logo, "light")).toBe(brand?.logo?.dark);
  });
  it("a file the module does not ship stays empty, without falling back file by file", () => {
    const iconOnly: ActiveModule = {
      id: "warps",
      version: null,
      brand: { hash: "h", files: ["icon"] },
    };
    const brand = moduleBrand("warps", "srv", [iconOnly]);
    expect(brand?.icon).toContain("/modules/warps/brand/icon.svg");
    expect(brand?.logo).toBeUndefined();
    expect(brand?.wordmark).toBeUndefined();
  });
  it("a module without one, and no module, keep Artisan's", () => {
    expect(moduleBrand("my-addon", "srv", [{ id: "my-addon", version: null }])).toBeUndefined();
    expect(moduleBrand(undefined, "srv", [auctions])).toBeUndefined();
  });
  it("the editor ships every built-in file it points at", () => {
    for (const id of [
      "attribution",
      "auctions",
      "boosts",
      "conversations",
      "daily",
      "guilds",
      "lands",
      "msquests",
      "boutique",
      "warps",
    ]) {
      const brand = builtInBrand(id)!;
      for (const url of [
        brand.icon,
        brand.logo?.dark,
        brand.logo?.light,
        brand.wordmark?.dark,
        brand.wordmark?.light,
      ])
        expect(existsSync(resolve(__dirname, "../../public", `.${url}`))).toBe(true);
    }
  });
});
