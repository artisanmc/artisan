import type * as React from "react";

import { cn } from "@/lib/cx";

type IconProps = React.SVGProps<SVGSVGElement>;

/**
 * Solid floppy disk. Lucide's outline Save turns into a blob when filled, so the
 * shutter and label are cut out of the body instead (even-odd fill).
 */
export function SaveFilledIcon({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      data-icon="save-filled"
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      <path d="M5 3h11.6L21 7.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.5 1.5V8.5h8v-4Zm5.5 1h1.5v2H13ZM7 13v6.5h10V13Z" />
    </svg>
  );
}
