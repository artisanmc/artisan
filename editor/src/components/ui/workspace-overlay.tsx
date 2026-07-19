import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cx";
import * as React from "react";

/**
 * Near-fullscreen overlay for the workspace's secondary views (Translations,
 * Data sources, History): the canvas stays ALIVE underneath — closing (Esc,
 * backdrop click, ×) is a return, not a navigation. `narrow` fits reading
 * content (History); the default `wide` hosts two-pane working views.
 * Full-screen below lg (mobile-first: no floating window on small screens).
 */
export function WorkspaceOverlay({
  open,
  onClose,
  title,
  size = "wide",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "wide" | "narrow";
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "flex h-[90vh] w-[94vw] flex-col gap-4 p-6",
          size === "wide" ? "max-w-5xl" : "max-w-3xl",
          "max-lg:h-dvh max-lg:w-screen max-lg:max-w-none max-lg:rounded-none max-lg:p-4",
        )}
      >
        <DialogTitle
          className="display shrink-0 text-[26px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
