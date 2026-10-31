import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { brandAsset, moduleBrand } from "@/lib/moduleBrand";
import { describe, expect, it } from "vitest";

describe("moduleBrand", () => {
  it("finds a module's logo by its id or its plugin's id", () => {
    expect(moduleBrand("auctions")?.id).toBe("auctions");
    expect(moduleBrand("boutique")?.id).toBe("store");
    expect(moduleBrand("daily")?.id).toBe("daily-rewards");
    expect(moduleBrand("msquests")?.id).toBe("quests");
  });
  it("leaves a module without one, and no module, on the Artisan logo", () => {
    expect(moduleBrand("conversations")).toBeUndefined();
    expect(moduleBrand(undefined)).toBeUndefined();
  });
  it("points at the theme's file, the icon has one for both", () => {
    const store = moduleBrand("store")!;
    expect(brandAsset(store, "wordmark", "light")).toBe("/brand/modules/store/wordmark-light.svg");
    expect(brandAsset(store, "icon", "dark")).toBe("/brand/modules/store/icon.svg");
  });
  it("ships every file it points at", () => {
    for (const id of [
      "attribution",
      "auctions",
      "boosts",
      "daily",
      "guilds",
      "lands",
      "msquests",
      "boutique",
      "warps",
    ]) {
      const brand = moduleBrand(id)!;
      for (const file of ["wordmark", "logo", "icon"] as const)
        for (const theme of ["dark", "light"] as const)
          expect(
            existsSync(resolve(__dirname, "../../public", `.${brandAsset(brand, file, theme)}`)),
          ).toBe(true);
    }
  });
});
