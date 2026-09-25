/** `chest_texture`: generic_54 layout, source of the chests drawn back (cf. vanillaGui.ts). */
export type AssetUsage = "button" | "menu" | "chest_texture";

/** Invalid hand-edited metadata leaves the image available for classification. */
export function parseAssetUsages(value: unknown): AssetUsage[] | undefined {
  if (!Array.isArray(value) || !value.every((usage) => usage === "button" || usage === "menu" || usage === "chest_texture" || usage === "background" || usage === "decoration")) return undefined;
  return [...new Set(value.map((usage) => usage === "background" || usage === "decoration" ? "menu" : usage))] as AssetUsage[];
}
