import { assetPreviewUrl } from "@/domain/asset";
import { KIT_PREFIX } from "@/lib/pack/kit";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SLOT } from "./imageGuides";
import { useKitAssets } from "./kitAssets";

/** The game's pixels, twice: large enough to judge, small enough to read as a menu. */
export const SITUATION_SCALE = 2;
/** Where the image sits: the second slot of the second row, so it has neighbours on each side. */
const AT = { column: 1, row: 1 };
const FIRST_SLOT = { x: 7, y: 17 };

/**
 * An image on slots shown where a player sees it: on the kit's window, over its slots, at the
 * size of the game. `children` is the image drawn at `SITUATION_SCALE`, live: an image judged
 * alone at fourteen times its size misleads.
 */
export function SituationPreview({
  width,
  height,
  children,
}: {
  /** The image's size, in its own pixels. */
  width: number;
  height: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const kit = useKitAssets();
  const source = (name: string) => {
    const asset = kit.find((a) => a.id === KIT_PREFIX + name);
    return asset ? assetPreviewUrl(asset) : "";
  };
  const window = useAuthenticatedImageUrl(source("window.6"));
  const cell = useAuthenticatedImageUrl(source("cell"));
  const s = SITUATION_SCALE;
  const rows = Math.ceil(height / SLOT) + 2;
  const columns = 9;
  return (
    <figure className="flex flex-col gap-1" data-testid="situation-preview">
      <div className="flex justify-center overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)] p-3">
        <div
          className="relative shrink-0 overflow-hidden"
          style={{
            width: 176 * s,
            height: (FIRST_SLOT.y + rows * SLOT + 7) * s,
            backgroundImage: window ? `url("${window}")` : undefined,
            backgroundSize: `${176 * s}px auto`,
            backgroundRepeat: "no-repeat",
            imageRendering: "pixelated",
          }}
        >
          <span
            aria-hidden
            className="absolute"
            style={{
              left: FIRST_SLOT.x * s,
              top: FIRST_SLOT.y * s,
              width: columns * SLOT * s,
              height: rows * SLOT * s,
              backgroundImage: cell ? `url("${cell}")` : undefined,
              backgroundSize: `${SLOT * s}px ${SLOT * s}px`,
              imageRendering: "pixelated",
            }}
          />
          <div
            className="absolute overflow-hidden"
            style={{
              left: (FIRST_SLOT.x + AT.column * SLOT) * s,
              top: (FIRST_SLOT.y + AT.row * SLOT) * s,
              width: width * s,
              height: height * s,
            }}
          >
            {children}
          </div>
        </div>
      </div>
      <figcaption className="text-[11px] text-[var(--text-faint)]">
        {t("studio.situation")}
      </figcaption>
    </figure>
  );
}
