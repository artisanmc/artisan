import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/cx";

const badgeVariants = cva("badge", {
  variants: {
    variant: {
      amber: "badge-amber",
      sage: "badge-sage",
      terra: "badge-terra",
      brick: "badge-brick",
    },
  },
  defaultVariants: {
    variant: "sage",
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Pill status badge — React wrapper over the .badge/.badge-* utility classes. */
function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
