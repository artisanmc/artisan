import { type ModuleBrand, moduleBrand, themed } from "@/lib/moduleBrand";
import { useModulesStore } from "@/state/modulesStore";
import { useThemeStore } from "@/state/themeStore";

function useBrandTheme(): "dark" | "light" {
  return useThemeStore((s) => s.theme) === "light" ? "light" : "dark";
}

/**
 * The look of [moduleId] on the server whose modules are loaded: what its jar announces, else
 * the editor's copy for a suite module, else undefined (Artisan's own).
 */
export function useModuleBrand(moduleId: string | null | undefined): ModuleBrand | undefined {
  const active = useModulesStore((s) => s.active);
  const loadedKey = useModulesStore((s) => s.loadedKey);
  const serverId = loadedKey?.startsWith("u:") ? loadedKey.slice(2) : null;
  return moduleBrand(moduleId, serverId, active);
}

/**
 * Pixel-art wordmark (39×8 grid, the A is the Artisan symbol), shown ×3 so pixels stay square.
 * Inside a module that ships its own, the same wordmark in that module's colours.
 */
export function ArtisanWordmark({ brand }: { brand?: ModuleBrand }) {
  const theme = useBrandTheme();
  return (
    <img
      src={themed(brand?.wordmark, theme) ?? `/wordmark-${theme}.svg`}
      alt="Artisan"
      width={117}
      height={24}
      className="shrink-0 [image-rendering:pixelated]"
    />
  );
}

/** The wordmark's A alone (9×8 grid), for icon-only spots; ×3 like the wordmark. */
export function ArtisanSymbol() {
  const theme = useBrandTheme();
  return (
    <img
      src={`/symbol-${theme}.svg`}
      alt=""
      aria-hidden="true"
      width={27}
      height={24}
      className="shrink-0 [image-rendering:pixelated]"
    />
  );
}

/** A module's full logo ("Artisan Auctions"), ×3 like the wordmark; `alt` names the module. */
export function ModuleLogo({
  logo,
  alt,
}: {
  logo: NonNullable<ModuleBrand["logo"]>;
  alt: string;
}) {
  const theme = useBrandTheme();
  return (
    <img
      src={themed(logo, theme)}
      alt={alt}
      width={logo.width * 3}
      height={logo.height * 3}
      className="h-auto max-w-full shrink-0 [image-rendering:pixelated]"
    />
  );
}

/**
 * [placeholder] painted under the icon: shown while the icon loads (or if it fails), then
 * covered by it, the tile being opaque.
 */
function placeholderStyle(placeholder: string | undefined) {
  return placeholder
    ? { backgroundImage: `url("${placeholder}")`, backgroundSize: "100% 100%" }
    : undefined;
}

/** A module's crafting-table icon (16×16 grid), ×3: the tile at the head of its home. */
export function ModuleIcon({ src, placeholder }: { src: string; placeholder?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={48}
      height={48}
      style={placeholderStyle(placeholder)}
      className="shrink-0 [image-rendering:pixelated]"
    />
  );
}

/** A module's icon at its own 16 px grid, ×1: its row in the sidebar, in place of the folder. */
export function ModuleRowIcon({ src, placeholder }: { src: string; placeholder?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      style={placeholderStyle(placeholder)}
      className="-my-px shrink-0 [image-rendering:pixelated]"
    />
  );
}
