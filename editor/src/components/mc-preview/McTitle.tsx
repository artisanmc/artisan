import type { Style } from "@/lib/miniMessage";
import { TITLE } from "@/lib/mm/profiles";
import { McScene } from "./McScene";
import { McText } from "./McText";

export interface McTitleProps {
  title: string;
  subtitle?: string;
  defaults?: Style;
  /** GUI scale: the title is drawn 4× and the subtitle 2× on top of it. */
  scale?: number;
  className?: string;
}

/** `/title` on screen: the title centered at 4×, the subtitle at 2× below it. */
export function McTitle({ title, subtitle, defaults = TITLE.defaults, scale = 1, className }: McTitleProps) {
  return (
    <McScene height={150 * scale} className={className}>
      <div
        data-testid="mc-title"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4 * scale,
        }}
      >
        <McText source={title} defaults={defaults} scale={4 * scale} align="center" />
        {subtitle ? <McText source={subtitle} defaults={defaults} scale={2 * scale} align="center" /> : null}
      </div>
    </McScene>
  );
}
