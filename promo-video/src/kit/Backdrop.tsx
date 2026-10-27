import { AbsoluteFill } from "remotion";

/** Fond des écrans hors éditeur : la surface et la lueur verte du canvas. */
export function Backdrop() {
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse 70% 55% at 50% 0%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%), var(--surface)",
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
        }}
      />
    </AbsoluteFill>
  );
}
