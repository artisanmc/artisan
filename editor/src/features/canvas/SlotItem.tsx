import { Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import { headPreviewUrl } from "./headTexture";
import { useTextureUrl } from "./textureStore";
import { TEX_SCALE, TEX_SLOT_INNER } from "./menuLayout";

export interface SlotItemProps {
  material: string;
  innerX: number;
  innerY: number;
  count?: number;
  head?: string;
}

/**
 * Renders the visual content of a filled slot — vanilla MC item texture if
 * we have it bundled (most cases), or a small fallback Rect with the first 4
 * letters of the material name otherwise. The Rect is the slot Group's hit
 * shape; the Image draws on top of it so click/drag still register.
 *
 * Stack count (when > 1) is drawn bottom-right with a dark drop shadow,
 * matching the vanilla MC tooltip look.
 */
export function SlotItem({ material, innerX, innerY, count, head }: SlotItemProps) {
  const materialUrl = useTextureUrl(material);
  const url = headPreviewUrl(head) ?? materialUrl;
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
