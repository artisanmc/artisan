import type { Pack } from "@/domain/types";
import type { FieldLocation, PlaceholderEntry } from "./types";

/**
 * Walk the pack and the requested location to produce a flat list of
 * placeholder entries the user can insert in this field. Pure — no
 * side effects, safe to call from useMemo.
 */
export function compute(pack: Pack, location: FieldLocation): PlaceholderEntry[] {
  switch (location.kind) {
    case "menu":
    case "element":
    case "action": {
      const menu = pack.menus.find((m) => m.id === location.menuId);
      if (!menu) return [];
      return [];
    }
    case "dialog":
    case "dialog-action":
      return [];
  }
}
