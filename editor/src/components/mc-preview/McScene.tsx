import type { ReactNode } from "react";

/** A plain sky-over-grass backdrop for the HUD previews (title, action bar). */
export function McScene({
  children,
  height,
  className,
}: {
  children: ReactNode;
  height: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        height,
        width: "100%",
        overflow: "hidden",
        borderRadius: "var(--r-sm)",
        background:
          "linear-gradient(to bottom, var(--mc-scene-sky) 0%, var(--mc-scene-horizon) 62%, var(--mc-scene-ground) 62%)",
      }}
    >
      {children}
    </div>
  );
}
