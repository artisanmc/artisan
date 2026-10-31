import { type ModuleBrand, brandAsset } from "@/lib/moduleBrand";
import { useThemeStore } from "@/state/themeStore";

/**
 * Pixel-art wordmark (39×8 grid, the A is the Artisan symbol), shown ×3 so pixels stay square.
 * Inside a module that has its logo, the same wordmark in that module's colours.
 */
export function ArtisanWordmark({ brand }: { brand?: ModuleBrand }) {
  const theme = useThemeStore((s) => s.theme);
  const tone = theme === "light" ? "light" : "dark";
  return (
    <img
      src={brand ? brandAsset(brand, "wordmark", tone) : `/wordmark-${tone}.svg`}
      alt="Artisan"
      width={117}
      height={24}
      className="shrink-0 [image-rendering:pixelated]"
    />
  );
}

/** The wordmark's A alone (9×8 grid), for icon-only spots; ×3 like the wordmark. */
export function ArtisanSymbol() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <img
      src={theme === "light" ? "/symbol-light.svg" : "/symbol-dark.svg"}
      alt=""
      aria-hidden="true"
      width={27}
      height={24}
      className="shrink-0 [image-rendering:pixelated]"
    />
  );
}

/** A module's full logo ("Artisan Auctions"), ×3 like the wordmark; `alt` names the module. */
export function ModuleLogo({ brand, alt }: { brand: ModuleBrand; alt: string }) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <img
      src={brandAsset(brand, "logo", theme === "light" ? "light" : "dark")}
      alt={alt}
      width={brand.logo.width * 3}
      height={brand.logo.height * 3}
      className="h-auto max-w-full shrink-0 [image-rendering:pixelated]"
    />
  );
}

/** A module's crafting-table icon (16×16 grid), ×3: the tile at the head of its home. */
export function ModuleIcon({ brand }: { brand: ModuleBrand }) {
  return (
    <img
      src={brandAsset(brand, "icon", "dark")}
      alt=""
      aria-hidden="true"
      width={48}
      height={48}
      className="shrink-0 [image-rendering:pixelated]"
    />
  );
}
