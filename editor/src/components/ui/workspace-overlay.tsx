import { cn } from "@/lib/cx";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

/**
 * Near-fullscreen overlay for the workspace's secondary views (Translations,
 * Data sources, History, AI assistant): the canvas stays ALIVE underneath —
 * closing (Esc, backdrop click, ×) is a return, not a navigation. `narrow`
 * fits reading content; the default `wide` hosts two-pane working views.
 * Full-screen below lg (mobile-first: no floating window on small screens).
 *
 * KEEP-ALIVE: after the first open, the content stays MOUNTED (forceMount +
 * hidden) so the view's state — translation filters, an in-flight assistant
 * chat, the selected data source — survives close/reopen. Nothing renders at
 * all until the first open (no cost for views never visited).
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
  // Render-time latch (legal state-adjust-during-render): flips once on the
  // first open and never back — the keep-alive gate.
  const [everOpened, setEverOpened] = React.useState(false);
  if (open && !everOpened) setEverOpened(true);
  if (!everOpened && !open) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay
          forceMount
          className={cn(
            "fixed inset-0 z-50 bg-[var(--surface)]/85 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:hidden",
          )}
        />
        <DialogPrimitive.Content
          forceMount
          className={cn(
            "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] card duration-200",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:hidden",
            "flex h-[90vh] w-[94vw] flex-col gap-4 p-6",
            size === "wide" ? "max-w-5xl" : "max-w-3xl",
            "max-lg:h-dvh max-lg:w-screen max-lg:max-w-none max-lg:rounded-none max-lg:p-4",
          )}
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <DialogPrimitive.Title
            className="display shrink-0 text-[26px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
