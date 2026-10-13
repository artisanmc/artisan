export type AssetUsage = "button" | "menu";

const USAGES = new Set(["button", "menu", "background", "decoration"]);
/** Container textures moved to the server `config.yml` (ADR `server-config-from-editor`). */
const DROPPED = new Set(["chest_texture", "hopper_texture", "dispenser_texture"]);

/** Invalid hand-edited metadata leaves the image available for classification. */
export function parseAssetUsages(value: unknown): AssetUsage[] | undefined {
  if (!Array.isArray(value) || !value.every((usage) => USAGES.has(usage) || DROPPED.has(usage)))
    return undefined;
  return [
    ...new Set(
      value
        .filter((usage) => !DROPPED.has(usage))
        .map((usage) => (usage === "background" || usage === "decoration" ? "menu" : usage)),
    ),
  ] as AssetUsage[];
}
