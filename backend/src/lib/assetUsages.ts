export type AssetUsage = "button" | "menu";

/** Invalid hand-edited metadata leaves the image available for classification. */
export function parseAssetUsages(value: unknown): AssetUsage[] | undefined {
  if (!Array.isArray(value) || !value.every((usage) => usage === "button" || usage === "menu" || usage === "background" || usage === "decoration")) return undefined;
  return [...new Set(value.map((usage) => usage === "background" || usage === "decoration" ? "menu" : usage))] as AssetUsage[];
}
