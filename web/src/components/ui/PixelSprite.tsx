import type { CSSProperties } from 'react';
import { getPalette } from '@/data/spritePalettes';
import { getPixels } from '@/data/itemPixels';

interface PixelSpriteProps {
  /** Item identifier — must match a key in ITEM_PIXELS / SPRITE_PALETTES. */
  name: string;
  /** Render size in CSS pixels. Defaults to 32. */
  size?: number;
  /** Apply enchant glow filter (used for "enchanted" items). */
  glow?: boolean;
  /** Optional inline style passthrough. */
  style?: CSSProperties;
}

/**
 * Renders a deterministic 8×8 pixel icon for any known item name.
 * SVG is used (not raster) so icons stay crisp at any size and stay tiny in
 * bundle size. Unknown names fall back to the stone sprite.
 */
export function PixelSprite({
  name,
  size = 32,
  glow = false,
  style,
}: PixelSpriteProps) {
  const palette = getPalette(name);
  const pixels = getPixels(name);
  const colors = ['transparent', ...palette];

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        imageRendering: 'pixelated',
        filter: glow ? 'drop-shadow(0 0 4px rgba(255,200,255,0.9))' : 'none',
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 8 8"
        style={{ display: 'block', imageRendering: 'pixelated' }}
        shapeRendering="crispEdges"
        aria-label={name}
      >
        {pixels.map((row, r) =>
          row.split('').map((c, ci) => {
            const idx = parseInt(c, 10);
            if (!idx) return null;
            return (
              <rect
                key={`${r}-${ci}`}
                x={ci}
                y={r}
                width={1}
                height={1}
                fill={colors[idx]}
              />
            );
          })
        )}
      </svg>
      {glow && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(135deg, rgba(255,200,255,0.18), transparent 60%)',
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
