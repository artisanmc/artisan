import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { tween } from "../kit/anim";
import { Backdrop } from "../kit/Backdrop";

export function Intro() {
  const frame = useCurrentFrame();
  // Le logo pixel apparaît par paliers, comme un bloc posé.
  const step = Math.min(1, Math.floor(interpolate(frame, [4, 22], [0, 6], { extrapolateRight: "clamp" })) / 6);
  const lift = tween(frame, [40, 62], [0, -70]);
  const line = tween(frame, [46, 66], [0, 1]);
  const out = tween(frame, [104, 120], [1, 0]);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Img
          src={staticFile("brand/horizontal-etabli-a-symbole-sombre.svg")}
          style={{
            width: 720,
            imageRendering: "pixelated",
            transform: `translateY(${lift}px) scale(${0.85 + 0.15 * step})`,
            opacity: step,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "58%",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 76,
            letterSpacing: "-0.035em",
            color: "var(--text)",
            opacity: line,
            transform: `translateY(${(1 - line) * 20}px)`,
            textAlign: "center",
          }}
        >
          Your server deserves <span style={{ color: "var(--brand)" }}>menus of its own.</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
