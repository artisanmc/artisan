import type { LText, MenuTitleLayer } from "./types";

const DEFAULT_TEXT_X = 8;
const DEFAULT_TEXT_Y = 5;

export function migrateTitle(
  legacy: LText | MenuTitleLayer[] | null | undefined,
): MenuTitleLayer[] {
  if (Array.isArray(legacy)) return legacy;
  if (!legacy) return [];
  return [{ kind: "text", value: legacy, x: DEFAULT_TEXT_X, y: DEFAULT_TEXT_Y }];
}
