import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";

import { cn } from "@/lib/cx";

export interface TooltipProps {
  /** Bubble text. Also becomes the trigger's accessible description. */
  content: React.ReactNode;
  /** A single focusable element. A `disabled` button never gets hovered: use `aria-disabled`. */
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/** Instant arrowed bubble on hover and keyboard focus — replaces the native `title`. */
function Tooltip({ content, children, side = "bottom", className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={0} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[60] max-w-64 rounded-[var(--r-sm)] bg-[var(--text)] px-2.5 py-1.5 text-xs leading-snug text-[var(--surface)] shadow-[var(--shadow-sm)]",
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow
              data-tooltip-arrow=""
              width={10}
              height={5}
              className="fill-[var(--text)]"
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip };
