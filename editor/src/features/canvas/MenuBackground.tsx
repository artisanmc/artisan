import type { Menu } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { Image as KonvaImage, Rect } from "react-konva";
import useImage from "use-image";
import { INVENTORY_TYPES } from "./inventoryTypes";
import {
  TEXTURE_URLS,
  TEX_SCALE,
  TEX_SLOT_STRIDE,
  bottomPieceCrop,
  bottomPieceY,
  menuBoxSize,
  singleBackgroundCrop,
  topPieceCrop,
  transparentOutline,
  usesSingleBackground,
} from "./menuLayout";

/**
 * A menu's background. Chest uses two vanilla slices so its height adapts to
 * `rows`; hopper/dropper use a single full-box crop; `vanilla_texture: false`
 * is a transparent window in game, only guides remain. Images are
 * listening=true so the menu Group has a hit shape and drag works from
 * anywhere on the texture (Konva picks the deepest draggable, so filled slots
 * still take precedence).
 */
export function MenuBackground({ menu }: { menu: Menu }) {
  const borderStrong = useCssVar("--border-strong");
  const type = menu.inventoryType ?? "chest";
  const [tex] = useImage(TEXTURE_URLS[INVENTORY_TYPES[type].textureKey]);
  const box = menuBoxSize(type, menu.rows);
  const outline = menu.vanillaTexture === false ? transparentOutline(type, menu.rows) : null;

  if (outline) {
    return (
      <>
        {/* Transparent fill keeps a hit shape: the menu still drags from anywhere. */}
        <Rect
          width={box.width}
          height={box.height}
          fill="rgba(0,0,0,0)"
          stroke={borderStrong}
          strokeWidth={1}
          dash={[6, 4]}
          opacity={0.6}
          perfectDrawEnabled={false}
        />
        {outline.cells.map((cell, i) => (
          <Rect
            // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
            key={`guide-${i}`}
            x={cell.x}
            y={cell.y}
            width={TEX_SLOT_STRIDE}
            height={TEX_SLOT_STRIDE}
            stroke={borderStrong}
            strokeWidth={1}
            opacity={0.35}
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
      </>
    );
  }
  if (!tex) {
    return <Rect width={box.width} height={box.height} fill="#c6c6c6" perfectDrawEnabled={false} />;
  }
  if (usesSingleBackground(type)) {
    const fullCrop = singleBackgroundCrop(type);
    return (
      <KonvaImage
        image={tex}
        x={0}
        y={0}
        width={fullCrop.width * TEX_SCALE}
        height={fullCrop.height * TEX_SCALE}
        crop={fullCrop}
        perfectDrawEnabled={false}
      />
    );
  }
  const top = topPieceCrop(menu.rows);
  const bottom = bottomPieceCrop();
  return (
    <>
      <KonvaImage
        image={tex}
        x={0}
        y={0}
        width={top.width * TEX_SCALE}
        height={top.height * TEX_SCALE}
        crop={top}
        perfectDrawEnabled={false}
      />
      <KonvaImage
        image={tex}
        x={0}
        y={bottomPieceY(menu.rows)}
        width={bottom.width * TEX_SCALE}
        height={bottom.height * TEX_SCALE}
        crop={bottom}
        perfectDrawEnabled={false}
      />
    </>
  );
}
