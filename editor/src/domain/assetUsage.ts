import type { Asset, AssetUsage } from "./asset";
import type { Menu, Project } from "./types";

export const ASSET_USAGES: AssetUsage[] = ["button", "menu", "chest_texture"];

function menuUsages(asset: Asset, menu: Menu): AssetUsage[] {
  const usages = new Set<AssetUsage>();
  for (const layer of menu.title) {
    if ((layer.kind === "background" || layer.kind === "glyph") && layer.assetId === asset.id)
      usages.add("menu");
  }
  for (const layer of menu.layers) {
    for (const element of layer.elements) {
      for (const appearance of [element.display, ...element.states]) {
        if (appearance.image?.asset === asset.id || appearance.assetId === asset.id)
          usages.add("button");
      }
    }
  }
  return [...usages];
}

export function assetUsages(asset: Asset, project?: Project): AssetUsage[] {
  if (asset.type === "font") return [];
  if (asset.usages !== undefined)
    return [
      ...new Set(
        asset.usages.map((usage) =>
          usage === "background" || usage === "decoration" ? "menu" : usage,
        ),
      ),
    ];
  if (!project || asset.projectId !== project.id) return [];
  const inferred = new Set(project.menus.flatMap((menu) => menuUsages(asset, menu)));
  return ASSET_USAGES.filter((usage) => inferred.has(usage));
}

export function assetMenuReferences(asset: Asset, project?: Project): string[] {
  if (!project || asset.projectId !== project.id) return [];
  return project.menus.filter((menu) => menuUsages(asset, menu).length > 0).map((menu) => menu.id);
}
