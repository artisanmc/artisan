import { migrateBuyCommands, parseShopYaml, serializeShopYaml } from "./shopYaml";

export interface BoutiqueItem {
  id: string;
  name: string;
  icon: string;
  price: number;
  discount: number;
  lore: string[];
  /** Purchase actions as an **Action DSL string** (the module-data `actions`
   *  wire, literal text — cf. ADR `action-dsl`). Runs via `api.actions.execute`
   *  after payment. Legacy `buy_commands`/`buyCommands` migrate to
   *  `run_command "…" as console` lines on read. */
  actions: string;
}

export interface BoutiqueCategory {
  id: string;
  name: string;
  icon: string;
  discount: number;
  items: BoutiqueItem[];
}

export interface BoutiqueState {
  wholeShopDiscount: number;
  categories: BoutiqueCategory[];
  /** Unknown `__files` entries (everything except shop.yaml) — re-emitted verbatim on export. */
  extraFiles?: Record<string, string>;
  /** Raw shop.yaml bytes when parsing failed — exported verbatim while `parseFailed`. */
  rawShopYaml?: string;
  /** True when `__files["shop.yaml"]` exists but doesn't parse; an explicit screen edit clears it. */
  parseFailed?: boolean;
}

export const EMPTY_STATE: BoutiqueState = { wholeShopDiscount: 0, categories: [] };

interface ProjectLike {
  moduleData?: Record<string, unknown>;
}

/** Structured moduleData.boutique, or normalisation of the seeded `__files` shape. */
export function readBoutiqueState(project: unknown): BoutiqueState {
  const md = (project as ProjectLike).moduleData?.boutique;
  if (!md || typeof md !== "object") return EMPTY_STATE;
  const raw = md as Record<string, unknown>;
  if (raw.__files && typeof raw.__files === "object") {
    const allFiles = raw.__files as Record<string, string>;
    const extraFiles: Record<string, string> = {};
    for (const [rel, content] of Object.entries(allFiles)) {
      if (rel !== "shop.yaml") extraFiles[rel] = content;
    }
    const extras = Object.keys(extraFiles).length > 0 ? { extraFiles } : {};
    const content = allFiles["shop.yaml"];
    if (content === undefined) return { ...EMPTY_STATE, ...extras };
    const parsed = parseShopYaml(content);
    if (!parsed) return { ...EMPTY_STATE, ...extras, rawShopYaml: content, parseFailed: true };
    return { ...parsed, ...extras };
  }
  if (Array.isArray(raw.categories)) {
    // Structured moduleData written before the actions migration may still
    // carry `buyCommands` — normalize so every item has `actions`.
    const state = raw as unknown as BoutiqueState;
    return {
      ...state,
      categories: state.categories.map((c) => ({
        ...c,
        items: c.items.map((i) => {
          if (typeof i.actions === "string") return i;
          const legacy = (i as unknown as { buyCommands?: unknown }).buyCommands;
          const { buyCommands: _dropped, ...rest } = i as unknown as Record<string, unknown>;
          return {
            ...(rest as unknown as BoutiqueItem),
            actions: migrateBuyCommands(Array.isArray(legacy) ? legacy.map(String) : []),
          };
        }),
      })),
    };
  }
  return EMPTY_STATE;
}

export function hasBoutiqueData(project: unknown): boolean {
  return (project as ProjectLike).moduleData?.boutique !== undefined;
}

/**
 * Export the boutique namespace files. Data-loss guards:
 * - `extraFiles` (unknown __files entries) are re-emitted verbatim;
 * - while `parseFailed`, the original shop.yaml bytes are emitted instead of an
 *   empty catalog (an explicit screen edit clears the flag and takes over).
 */
export function exportBoutiqueFiles(project: unknown): Record<string, string> {
  const state = readBoutiqueState(project);
  if (!hasBoutiqueData(project) && state.categories.length === 0) return {};
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(state.extraFiles ?? {})) {
    files[`boutique/${rel}`] = content;
  }
  files["boutique/shop.yaml"] =
    state.parseFailed && state.rawShopYaml !== undefined
      ? state.rawShopYaml
      : serializeShopYaml(state);
  return files;
}
