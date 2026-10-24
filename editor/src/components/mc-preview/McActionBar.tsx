import type { Style } from "@/lib/miniMessage";
import { ACTION_BAR } from "@/lib/mm/profiles";
import { McScene } from "./McScene";
import { McText } from "./McText";

export interface McActionBarProps {
  text: string;
  defaults?: Style;
  scale?: number;
  className?: string;
}

/** The action bar: one line centered above the hotbar. */
export function McActionBar({ text, defaults = ACTION_BAR.defaults, scale = 2, className }: McActionBarProps) {
  return (
    <McScene height={90 * scale} className={className}>
      <div
        data-testid="mc-actionbar"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 4 * scale,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8 * scale,
        }}
      >
        <McText source={text} defaults={defaults} scale={scale} align="center" />
        <div
          aria-hidden
          style={{
            width: 182 * scale,
            maxWidth: "90%",
            height: 22 * scale,
            background: "var(--mc-hotbar-bg)",
            border: `${scale}px solid var(--mc-hotbar-border)`,
          }}
        />
      </div>
    </McScene>
  );
}
