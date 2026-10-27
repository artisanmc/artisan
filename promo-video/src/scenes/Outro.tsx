import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { tween } from "../kit/anim";
import { Backdrop } from "../kit/Backdrop";

export function Outro() {
  const frame = useCurrentFrame();
  const logo = tween(frame, [0, 16], [0, 1]);
  const cta = tween(frame, [14, 30], [0, 1]);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 56 }}>
        <Img
          src={staticFile("brand/horizontal-etabli-a-symbole-sombre.svg")}
          style={{ width: 620, imageRendering: "pixelated", opacity: logo, transform: `scale(${0.94 + 0.06 * logo})` }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, opacity: cta }}>
          <div
            className="btn btn-primary"
            style={{ fontSize: 30, padding: "18px 36px", height: "auto", borderRadius: "var(--r-md)" }}
          >
            Try the demo, no account needed
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 30, color: "var(--text-mut)" }}>
            editor.artisanmc.net
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
