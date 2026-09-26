/** `*_texture`: a vanilla container layout, source of the windows drawn back (cf. vanillaGui.ts). */
export type AssetUsage = "button" | "menu" | "chest_texture" | "hopper_texture" | "dispenser_texture";

const USAGES = new Set(["button", "menu", "chest_texture", "hopper_texture", "dispenser_texture", "background", "decoration"]);

/** Invalid hand-edited metadata leaves the image available for classification. */
export function parseAssetUsages(value: unknown): AssetUsage[] | undefined {
  if (!Array.isArray(value) || !value.every((usage) => USAGES.has(usage))) return undefined;
  return [...new Set(value.map((usage) => usage === "background" || usage === "decoration" ? "menu" : usage))] as AssetUsage[];
}
