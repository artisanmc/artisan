import { useThemeStore } from "@/state/themeStore";

/** Pixel-art wordmark (39×8 grid, the A is the Artisan symbol), shown ×3 so pixels stay square. */
export function ArtisanWordmark() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <img
      src={theme === "light" ? "/wordmark-light.svg" : "/wordmark-dark.svg"}
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
