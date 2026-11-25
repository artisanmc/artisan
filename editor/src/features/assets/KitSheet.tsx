import type { Asset } from "@/domain/asset";
import { KIT_PREFIX, KIT_SLOTS } from "@/lib/pack/kit";
import { AssetPreview } from "./AssetPreview";

/** A piece wider than this is shown at the game's size, any other at twice it. */
const WIDE = 100;

/**
 * Every piece of the kit base side by side, as `kit` draws them: one sheet to compare with
 * another (a theme, no theme). It grows with the base, a piece needs no place on it.
 */
export function KitSheet({ kit }: { kit: readonly Asset[] }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {KIT_SLOTS.map((slot) => {
        const asset = kit.find((a) => a.id === KIT_PREFIX + slot.id);
        if (!asset) return null;
        const scale = slot.width > WIDE ? 1 : 2;
        return (
          <span key={slot.id} title={KIT_PREFIX + slot.id} data-testid={`kit-sheet-${slot.id}`}>
            <AssetPreview
              asset={asset}
              lazy
              style={{ width: slot.width * scale, height: slot.height * scale }}
            />
          </span>
        );
      })}
    </div>
  );
}
