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
