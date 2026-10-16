import { Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import { TEX_SCALE, TEX_SLOT_INNER } from "./menuLayout";
import { useTextureUrl } from "./textureStore";
import { useHeadPreviewUrl } from "./useHeadPreviewUrl";

export interface SlotItemProps {
  material: string;
  innerX: number;
  innerY: number;
  count?: number;
  head?: string;
  /** Item is enchanted (or forces the glint) — draws the enchantment marker. */
  enchanted?: boolean;
}

/**
 * Renders the visual content of a filled slot — vanilla MC item texture if
 * we have it bundled (most cases), or a small fallback Rect with the first 4
 * letters of the material name otherwise. The Rect is the slot Group's hit
 * shape; the Image draws on top of it so click/drag still register.
 *
 * Stack count (when > 1) is drawn bottom-right with a dark drop shadow,
 * matching the vanilla MC tooltip look.
 *
 * Enchanted items get a violet corner sparkle rather than a replica of the
 * vanilla glint shader: tinting only the sprite's opaque pixels would need a
 * cached Konva filter per slot, which a 54-slot menu can't afford. The marker
 * is unambiguous at this size, which is what the canvas needs.
 */
export function SlotItem({ material, innerX, innerY, count, head, enchanted }: SlotItemProps) {
  const materialUrl = useTextureUrl(material);
  const url = useHeadPreviewUrl(head) ?? materialUrl;
  const [image] = useImage(url ?? "");
  const showCount = (count ?? 0) > 1;
  const countText = String(count ?? 0);
  const countFontSize = 7 * TEX_SCALE;
  return (
    <>
      {/* Backdrop Rect — also acts as the slot Group's hit shape. */}
      <Rect
        x={innerX}
        y={innerY}
        width={TEX_SLOT_INNER}
        height={TEX_SLOT_INNER}
        fill={url ? "transparent" : "rgba(20,20,20,0.55)"}
        cornerRadius={2}
        perfectDrawEnabled={false}
      />
      {url && image ? (
        <KonvaImage
          image={image}
          x={innerX}
          y={innerY}
          width={TEX_SLOT_INNER}
          height={TEX_SLOT_INNER}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : (
        <Text
          x={innerX}
          y={innerY}
          width={TEX_SLOT_INNER}
          height={TEX_SLOT_INNER}
          text={material.slice(0, 4)}
          fontFamily="ui-monospace, monospace"
          fontSize={6 * TEX_SCALE}
          fill="#fafafa"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      )}
      {enchanted && (
        <>
          {/* Soft violet halo around the item well… */}
          <Rect
            x={innerX}
            y={innerY}
            width={TEX_SLOT_INNER}
            height={TEX_SLOT_INNER}
            stroke="#c77dff"
            strokeWidth={TEX_SCALE * 0.5}
            opacity={0.55}
            cornerRadius={2}
            listening={false}
            perfectDrawEnabled={false}
          />
          {/* …plus a sparkle top-left, away from the bottom-right stack count. */}
          <Text
            x={innerX}
            y={innerY}
            text="✦"
            fontSize={6 * TEX_SCALE}
            fill="#e0aaff"
            shadowColor="#2b0b3a"
            shadowBlur={0}
            shadowOffsetX={TEX_SCALE * 0.5}
            shadowOffsetY={TEX_SCALE * 0.5}
            listening={false}
          />
        </>
      )}
      {showCount && (
        <>
          {/* Drop shadow — same offset as vanilla's 1px shadow at our 2× scale. */}
          <Text
            x={innerX + TEX_SCALE}
            y={innerY + TEX_SLOT_INNER - countFontSize - TEX_SCALE + TEX_SCALE}
            width={TEX_SLOT_INNER}
            height={countFontSize}
            text={countText}
            fontFamily="ui-monospace, monospace"
            fontSize={countFontSize}
            fontStyle="bold"
            fill="#3f3f3f"
            align="right"
            listening={false}
          />
          <Text
            x={innerX}
            y={innerY + TEX_SLOT_INNER - countFontSize - TEX_SCALE}
            width={TEX_SLOT_INNER}
            height={countFontSize}
            text={countText}
            fontFamily="ui-monospace, monospace"
            fontSize={countFontSize}
            fontStyle="bold"
            fill="#ffffff"
            align="right"
            listening={false}
          />
        </>
      )}
    </>
  );
}
