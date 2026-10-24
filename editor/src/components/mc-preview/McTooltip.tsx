import { wrapLore } from "@/lib/loreWrap";
import type { Style } from "@/lib/miniMessage";
import { ITEM_NAME, LORE } from "@/lib/mm/profiles";
import { McText } from "./McText";

export interface McTooltipProps {
  /** The item's name (MiniMessage). */
  title: string;
  /** Lore entries, each parsed alone as in game. */
  lore?: string[];
  /** Enchantment lines, already formatted ("Sharpness V"). */
  enchants?: string[];
  /** `lore_max_width` in MC pixels: lines wrap as the plugin wraps them. */
  maxWidth?: number;
  titleDefaults?: Style;
  loreDefaults?: Style;
  scale?: number;
  className?: string;
}

const ENCHANT: Style = { color: "#aaaaaa", italic: false };

/**
 * An item tooltip as the client draws it: dark purple-black panel, violet gradient
 * border, name, enchantments, then the lore. Presentational: the caller resolves
 * placeholders and data first.
 */
export function McTooltip({
  title,
  lore = [],
  enchants = [],
  maxWidth = 0,
  titleDefaults = ITEM_NAME.defaults,
  loreDefaults = LORE.defaults,
  scale = 2,
  className,
}: McTooltipProps) {
  const lines = lore.flatMap((line) => wrapLore(line, maxWidth));
  const px = (n: number) => n * scale;
  return (
    <div
      data-testid="mc-tooltip"
      className={className}
      style={{
        display: "inline-block",
        background: "var(--mc-tooltip-bg)",
        padding: px(1),
        borderRadius: px(1),
      }}
    >
      <div
        style={{
          borderWidth: px(1),
          borderStyle: "solid",
          borderImage:
            "linear-gradient(to bottom, var(--mc-tooltip-border-top), var(--mc-tooltip-border-bottom)) 1",
          padding: `${px(2)}px ${px(2)}px ${px(1)}px`,
          display: "flex",
          flexDirection: "column",
          gap: px(2),
        }}
      >
        <McText source={title} defaults={titleDefaults} scale={scale} />
        {enchants.length + lines.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {enchants.length > 0 && (
              <McText source={enchants.join("\n")} perLine defaults={ENCHANT} scale={scale} />
            )}
            {lines.length > 0 && (
              <McText
                source={lines.join("\n")}
                perLine
                defaults={loreDefaults}
                scale={scale}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
