import type { ActiveModule, ModuleBrandFile } from "@/lib/api/modules";

/**
 * A module's look in the editor: its crafting-table icon (16×16 grid), its full logo
 * ("Artisan Auctions") and the Artisan wordmark in its colours, each as an image URL. A module
 * ships them in its jar (`ModuleBrandDeclaration`, announced at Presence, served by the hub);
 * a module without one keeps Artisan's wordmark and the generic tile.
 */
export interface ModuleBrand {
  icon?: string;
  logo?: { dark?: string; light?: string; width: number; height: number };
  wordmark?: { dark?: string; light?: string };
}

export type BrandTheme = "dark" | "light";

/** The file for [theme], else the other theme's: a module may draw one logo for both. */
export function themed(
  pair: { dark?: string; light?: string } | undefined,
  theme: BrandTheme,
): string | undefined {
  return theme === "light" ? (pair?.light ?? pair?.dark) : (pair?.dark ?? pair?.light);
}

/** The brand [module] announces, as URLs on the hub, or undefined when it ships none. */
export function announcedBrand(serverId: string, module: ActiveModule): ModuleBrand | undefined {
  const wire = module.brand;
  if (!wire || wire.files.length === 0) return undefined;
  const url = (file: ModuleBrandFile) =>
    wire.files.includes(file)
      ? `/api/v1/servers/${encodeURIComponent(serverId)}/modules/${encodeURIComponent(module.id)}/brand/${file}.svg?v=${wire.hash}`
      : undefined;
  const logoDark = url("logo-dark");
  const logoLight = url("logo-light");
  const wordmarkDark = url("wordmark-dark");
  const wordmarkLight = url("wordmark-light");
  return {
    icon: url("icon"),
    logo:
      (logoDark || logoLight) && wire.logo
        ? { dark: logoDark, light: logoLight, width: wire.logo.width, height: wire.logo.height }
        : undefined,
    wordmark:
      wordmarkDark || wordmarkLight ? { dark: wordmarkDark, light: wordmarkLight } : undefined,
  };
}

/**
 * The logos the editor itself carries for the suite's own modules (`public/brand/modules/`),
 * for a server whose module jar predates its own brand (API < 2.23.0). To delete once every
 * module ships its brand.
 */
const BUILT_IN: Record<string, { dir: string; width: number; height: number }> = {
  attribution: { dir: "attribution", width: 95, height: 8 },
  auctions: { dir: "auctions", width: 85, height: 8 },
  boosts: { dir: "boosts", width: 77, height: 8 },
  "daily-rewards": { dir: "daily-rewards", width: 112, height: 10 },
  guilds: { dir: "guilds", width: 72, height: 8 },
  lands: { dir: "lands", width: 73, height: 8 },
  quests: { dir: "quests", width: 77, height: 8 },
  store: { dir: "store", width: 71, height: 8 },
  warps: { dir: "warps", width: 73, height: 10 },
};

/** Module ids that name their plugin differently from their built-in logo. */
const ALIASES: Record<string, string> = {
  boutique: "store",
  daily: "daily-rewards",
  msquests: "quests",
  msguilds: "guilds",
  mslands: "lands",
  msboosts: "boosts",
};

export function builtInBrand(moduleId: string): ModuleBrand | undefined {
  const id = moduleId.toLowerCase();
  const entry = BUILT_IN[ALIASES[id] ?? id];
  if (!entry) return undefined;
  const base = `/brand/modules/${entry.dir}`;
  return {
    icon: `${base}/icon.svg`,
    logo: {
      dark: `${base}/logo-dark.svg`,
      light: `${base}/logo-light.svg`,
      width: entry.width,
      height: entry.height,
    },
    wordmark: { dark: `${base}/wordmark-dark.svg`, light: `${base}/wordmark-light.svg` },
  };
}

/**
 * [moduleId]'s brand: the one its jar announces on [serverId], else the built-in copy of a
 * suite module, else undefined.
 */
export function moduleBrand(
  moduleId: string | null | undefined,
  serverId: string | null | undefined,
  active: readonly ActiveModule[],
): ModuleBrand | undefined {
  if (!moduleId) return undefined;
  const announced = serverId ? active.find((m) => m.id === moduleId) : undefined;
  return (
    (announced && serverId ? announcedBrand(serverId, announced) : undefined) ??
    builtInBrand(moduleId)
  );
}
