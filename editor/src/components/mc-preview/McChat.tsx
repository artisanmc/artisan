import type { Style } from "@/lib/miniMessage";
import { CHAT } from "@/lib/mm/profiles";
import { McText } from "./McText";

export interface McChatProps {
  /** Chat messages, oldest first; each one may span several lines. */
  messages: string[];
  defaults?: Style;
  scale?: number;
  className?: string;
}

/** The chat box: messages on the client's translucent black, 320 MC pixels wide. */
export function McChat({ messages, defaults = CHAT.defaults, scale = 2, className }: McChatProps) {
  return (
    <div
      data-testid="mc-chat"
      className={className}
      style={{
        width: 320 * scale,
        maxWidth: "100%",
        background: "var(--mc-chat-line-bg)",
        padding: `${scale}px ${2 * scale}px`,
        overflow: "hidden",
      }}
    >
      {messages.map((m, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: messages have no identity
        <McText key={k} source={m} defaults={defaults} scale={scale} lineHeight={9} />
      ))}
    </div>
  );
}
