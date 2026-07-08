import { parseShopYaml } from "./shopYaml";

export interface BoutiqueItem {
  id: string;
  name: string;
  icon: string;
  price: number;
  discount: number;
  lore: string[];
  buyCommands: string[];
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
}

export const EMPTY_STATE: BoutiqueState = { wholeShopDiscount: 0, categories: [] };

interface ProjectLike {
  moduleData?: Record<string, unknown>;
}

/** moduleData.boutique structuré, ou normalisation de la forme __files seedée par le backend. */
export function readBoutiqueState(project: unknown): BoutiqueState {
  const md = (project as ProjectLike).moduleData?.boutique;
  if (!md || typeof md !== "object") return EMPTY_STATE;
  const raw = md as Record<string, unknown>;
  if (raw.__files && typeof raw.__files === "object") {
    const content = (raw.__files as Record<string, string>)["shop.yaml"];
    return (content && parseShopYaml(content)) || EMPTY_STATE;
  }
  if (Array.isArray(raw.categories)) return raw as unknown as BoutiqueState;
  return EMPTY_STATE;
}

export function hasBoutiqueData(project: unknown): boolean {
  return (project as ProjectLike).moduleData?.boutique !== undefined;
}
