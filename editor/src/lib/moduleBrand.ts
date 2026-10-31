/**
 * The pixel logos of the suite's own modules (branding/logo-pixel, `generer-modules.py`): the
 * Artisan wordmark in the module's colours, the full "Artisan <Module>" logo and its
 * crafting-table icon, served from `public/brand/modules/<brand>/`. Keyed by the module id a
 * project's owner reports (`ownerModuleOf`); a module without one keeps the Artisan logo.
 */
export interface ModuleBrand {
  /** Folder under `public/brand/modules/`. */
  id: string;
  /** Grid size of `logo-*.svg`, drawn ×3 like the wordmark so its pixels stay square. */
  logo: { width: number; height: number };
}

const BRANDS: Record<string, ModuleBrand> = {
  attribution: { id: "attribution", logo: { width: 95, height: 8 } },
  auctions: { id: "auctions", logo: { width: 85, height: 8 } },
  boosts: { id: "boosts", logo: { width: 77, height: 8 } },
  "daily-rewards": { id: "daily-rewards", logo: { width: 112, height: 10 } },
  guilds: { id: "guilds", logo: { width: 72, height: 8 } },
  lands: { id: "lands", logo: { width: 73, height: 8 } },
  quests: { id: "quests", logo: { width: 77, height: 8 } },
  store: { id: "store", logo: { width: 71, height: 8 } },
  warps: { id: "warps", logo: { width: 73, height: 10 } },
};

/** Module ids that name their plugin differently from their logo. */
const ALIASES: Record<string, string> = {
  boutique: "store",
  daily: "daily-rewards",
  msquests: "quests",
  msguilds: "guilds",
  mslands: "lands",
  msboosts: "boosts",
};

export function moduleBrand(moduleId: string | null | undefined): ModuleBrand | undefined {
  if (!moduleId) return undefined;
  const id = moduleId.toLowerCase();
  return BRANDS[ALIASES[id] ?? id];
}

export type BrandTheme = "dark" | "light";

export function brandAsset(
  brand: ModuleBrand,
  file: "wordmark" | "logo" | "icon",
  theme: BrandTheme,
): string {
  const name = file === "icon" ? "icon" : `${file}-${theme}`;
  return `/brand/modules/${brand.id}/${name}.svg`;
}
