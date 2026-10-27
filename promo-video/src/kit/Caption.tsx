import { interpolate } from "remotion";

interface CaptionProps {
  frame: number;
  start: number;
  end: number;
  title: string;
  /** Partie du titre mise en couleur de marque. */
  accent?: string;
  sub?: string;
  position?: "bottom-left" | "top-left" | "center";
}

/** Titre de scène, posé sur l'interface avec un voile pour rester lisible. */
export function Caption({ frame, start, end, title, accent, sub, position = "bottom-left" }: CaptionProps) {
  const t = interpolate(frame, [start, start + 14, end - 10, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [start, start + 18], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const parts = accent ? title.split(accent) : [title];
  const place =
    position === "center"
      ? { left: 0, right: 0, top: "50%", textAlign: "center" as const, transform: `translateY(calc(-50% + ${rise}px))` }
      : position === "top-left"
        ? { left: 96, top: 80, transform: `translateY(${rise}px)` }
        : { left: 96, bottom: 96, transform: `translateY(${rise}px)` };
  return (
    <div style={{ position: "absolute", ...place, opacity: t, zIndex: 50, pointerEvents: "none" }}>
      <div
        style={{
          display: "inline-block",
          padding: position === "center" ? 0 : "28px 36px",
          borderRadius: "var(--r-lg)",
          background: position === "center" ? "none" : "color-mix(in srgb, var(--surface) 88%, transparent)",
          border: position === "center" ? "none" : "1px solid var(--border-soft)",
          boxShadow: position === "center" ? "none" : "0 24px 60px rgba(0,0,0,.45)",
          backdropFilter: position === "center" ? "none" : "blur(8px)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: position === "center" ? 92 : 64,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: "var(--text)",
          }}
        >
          {parts.length === 2 ? (
            <>
              {parts[0]}
              <span style={{ color: "var(--brand)" }}>{accent}</span>
              {parts[1]}
            </>
          ) : (
            title
          )}
        </div>
        {sub && (
          <div
            style={{
              marginTop: 14,
              fontFamily: "var(--font-body)",
              fontSize: 28,
              color: "var(--text-mut)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
