import type { Asset } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { KIT_PREFIX, KIT_SLOTS, kitFootprint } from "@/lib/pack/kit";
import { AssetPreview } from "./AssetPreview";
import { TRIAL_MENU } from "./kitPieces";

/** The trial menu shows the game's pixels twice. */
const SCALE = 2;
const SLOT = 18;
const FIRST_SLOT = { x: 7, y: 17 };
const WINDOW = { width: 176, height: 222 };
/** The slots of a six-row chest: its own rows, the player's inventory, then the hotbar. */
const ROWS = [0, 1, 2, 3, 4, 5]
  .map((row) => FIRST_SLOT.y + row * SLOT)
  .concat(
    [0, 1, 2].map((row) => WINDOW.height - 83 + row * SLOT),
    WINDOW.height - 25,
  );
const CELLS = ROWS.flatMap((y) =>
  Array.from({ length: 9 }, (_, column) => ({ x: FIRST_SLOT.x + column * SLOT, y })),
);

/**
 * Every piece of the kit base set on one six-row window (`TRIAL_MENU`), at twice the game's
 * size: what `kit` looks like in a menu. With `onOpen`, a piece is a button.
 */
export function KitTrialMenu({
  kit,
  over = null,
  onOver,
  onOpen,
}: {
  /** The kit images to show, as `useKitAssets` or `useKitAssetsIn` gives them. */
  kit: readonly Asset[];
  /** The piece to outline. */
  over?: string | null;
  onOver?: (id: string | null) => void;
  onOpen?: (id: string) => void;
}) {
  const find = (name: string) => kit.find((a) => a.id === KIT_PREFIX + name);
  const windowAsset = find("window.6");
  const cell = find("cell");
  return (
    <div
      className="relative shrink-0"
      style={{ width: WINDOW.width * SCALE, height: WINDOW.height * SCALE }}
      data-testid="kit-trial-menu"
    >
      {windowAsset ? (
        <AssetPreview
          asset={windowAsset}
          className="absolute inset-0"
          style={{ width: WINDOW.width * SCALE, height: WINDOW.height * SCALE }}
        />
      ) : null}
      {cell
        ? CELLS.map(({ x, y }) => (
            <AssetPreview
              key={`${x},${y}`}
              asset={cell}
              className="absolute"
              style={{
                left: x * SCALE,
                top: y * SCALE,
                width: SLOT * SCALE,
                height: SLOT * SCALE,
              }}
            />
          ))
        : null}
      {KIT_SLOTS.map((slot) => {
        const at = TRIAL_MENU[slot.id];
        const shown = find(slot.id);
        const area = kitFootprint(KIT_PREFIX + slot.id);
        if (!at || !shown || !area) return null;
        // An image smaller than its slots sits in their middle, as the game draws it.
        const left = FIRST_SLOT.x + at.column * SLOT + (area.width * SLOT - slot.width) / 2;
        const top = FIRST_SLOT.y + at.row * SLOT + (area.height * SLOT - slot.height) / 2;
        const style = {
          left: left * SCALE,
          top: top * SCALE,
          width: slot.width * SCALE,
          height: slot.height * SCALE,
        };
        const outline = over === slot.id && "outline outline-2 outline-[var(--accent)]";
        return onOpen ? (
          <button
            key={slot.id}
            type="button"
            title={slot.id}
            className={cx("absolute cursor-pointer p-0", outline)}
            style={style}
            data-testid={`kit-trial-${slot.id}`}
            onClick={() => onOpen(slot.id)}
            onMouseEnter={() => onOver?.(slot.id)}
            onMouseLeave={() => onOver?.(null)}
          >
            <AssetPreview asset={shown} className="h-full w-full" />
          </button>
        ) : (
          <span
            key={slot.id}
            title={slot.id}
            className={cx("absolute", outline)}
            style={style}
            data-testid={`kit-trial-${slot.id}`}
          >
            <AssetPreview asset={shown} className="h-full w-full" />
          </span>
        );
      })}
    </div>
  );
}
