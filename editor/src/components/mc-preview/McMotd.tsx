import type { Style } from "@/lib/miniMessage";
import { MOTD } from "@/lib/mm/profiles";
import { McText } from "./McText";

export interface McMotdProps {
  /** The MOTD: two lines at most, `\n` between them. */
  motd: string;
  /** The server's name, drawn white above the MOTD. */
  name?: string;
  /** URL of the 64×64 server icon. */
  icon?: string;
  defaults?: Style;
  scale?: number;
  className?: string;
}

/** A server list entry: icon, name, the two MOTD lines and the ping bars. */
export function McMotd({
  motd,
  name = "Minecraft Server",
  icon,
  defaults = MOTD.defaults,
  scale = 2,
  className,
}: McMotdProps) {
  const lines = motd.split("\n").slice(0, 2).join("\n");
  return (
    <div
      data-testid="mc-motd"
      className={className}
      style={{
        display: "flex",
        gap: 3 * scale,
        width: 305 * scale,
        maxWidth: "100%",
        padding: 2 * scale,
        background: "var(--mc-list-bg)",
        border: `${scale}px solid var(--mc-list-border)`,
      }}
    >
      <div
        style={{
          width: 32 * scale,
          height: 32 * scale,
          flexShrink: 0,
          background: "var(--mc-icon-bg)",
          backgroundImage: icon ? `url(${icon})` : undefined,
          backgroundSize: "cover",
          imageRendering: "pixelated",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: scale, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <McText source={name} defaults={{ color: "#ffffff" }} scale={scale} />
          <div
            aria-hidden
            style={{ display: "flex", alignItems: "flex-end", gap: scale, height: 8 * scale }}
          >
            {[2, 3, 4, 5, 6].map((h) => (
              <span
                key={h}
                style={{ width: scale, height: h * scale, background: "var(--mc-ping)" }}
              />
            ))}
          </div>
        </div>
        <McText source={lines} defaults={defaults} scale={scale} lineHeight={9} />
      </div>
    </div>
  );
}
