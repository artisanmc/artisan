import type { Asset } from "@/domain/asset";
import { KIT_PREFIX, kitNameOf, kitSlot } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { useMemo } from "react";
import { useKitAssets } from "./kitAssets";

/** What an image held by a theme does to the places below it. */
export type ThemePlaceMark = "replacesBase" | "addedHere";

/**
 * What an image of a theme does (ADR `resources-one-screen`, decision 6): `replacesBase` when a
 * place below the theme has an image of that name, `addedHere` otherwise. Below the server's own
 * theme is Artisan's base; below another theme, the server's theme and the base.
 */
export function themePlaceMark(
  name: string,
  place: "server" | "theme",
  serverNames: ReadonlySet<string>,
): ThemePlaceMark {
  if (kitSlot(name)) return "replacesBase";
  return place === "theme" && serverNames.has(name) ? "replacesBase" : "addedHere";
}

/**
 * [themePlaceMark] of the images of the open Project `projectId`: `null` for every image when
 * the Project is a module, for a font, and for a piece of the base the server's theme lists as
 * shipped (it holds no file of it).
 */
export function useThemePlaceMark(projectId: string): (asset: Asset) => ThemePlaceMark | null {
  const server = useKitStore((s) => s.read?.projectId === projectId);
  const theme = useKitStore((s) =>
    Object.values(s.own).some((held) => held.projectId === projectId),
  );
  // The names the server's theme and the base hold.
  const common = useKitAssets();
  const serverNames = useMemo(
    () =>
      new Set(
        common
          .filter((asset) => asset.id.startsWith(KIT_PREFIX))
          .map((asset) => kitNameOf(asset.id) ?? asset.name),
      ),
    [common],
  );
  return (asset) => {
    if ((!server && !theme) || asset.type === "font") return null;
    if (server && !asset.contentHash) return null;
    return themePlaceMark(asset.name, server ? "server" : "theme", serverNames);
  };
}
