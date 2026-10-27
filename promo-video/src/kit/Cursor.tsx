import { interpolate } from "remotion";
import type { Point } from "./anim";

interface CursorProps {
  at: Point;
  frame: number;
  /** Images où le curseur clique : un anneau de la couleur de marque s'en échappe. */
  clicks?: number[];
  /** Texture portée pendant un glisser-déposer. */
  carrying?: string | null;
  opacity?: number;
}

export function Cursor({ at, frame, clicks = [], carrying, opacity = 1 }: CursorProps) {
  const click = clicks.find((c) => frame >= c && frame < c + 14);
  const progress = click === undefined ? 1 : (frame - click) / 14;
  const press = click === undefined ? 1 : interpolate(progress, [0, 0.3, 1], [1, 0.85, 1]);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity, zIndex: 100 }}>
      {click !== undefined && (
        <div
          style={{
            position: "absolute",
            left: at.x - 28,
            top: at.y - 28,
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "3px solid var(--brand)",
            transform: `scale(${0.3 + progress})`,
            opacity: 1 - progress,
          }}
        />
      )}
      {carrying && (
        <img
          src={carrying}
          alt=""
          style={{
            position: "absolute",
            left: at.x - 16,
            top: at.y - 16,
            width: 40,
            height: 40,
            imageRendering: "pixelated",
            opacity: 0.85,
            filter: "drop-shadow(0 6px 10px rgba(0,0,0,.5))",
          }}
        />
      )}
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        style={{
          position: "absolute",
          left: at.x - 3,
          top: at.y - 2,
          transform: `scale(${press})`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,.6))",
        }}
      >
        <path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#0f1115" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
