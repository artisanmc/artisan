import { cn } from "@/lib/cx";
import { X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

/**
 * Near-fullscreen overlay for the workspace's secondary views (Translations,
 * Data sources, History, AI assistant): the canvas stays ALIVE underneath —
 * closing (Esc, backdrop click, ×) is a return, not a navigation. `narrow`
 * fits reading content; the default `wide` hosts two-pane working views.
 * Full-screen below lg (mobile-first: no floating window on small screens).
 *
 * KEEP-ALIVE: after the first open, the content stays MOUNTED (hidden) so the
 * view's state — translation filters, an in-flight assistant chat, the
 * selected data source — survives close/reopen. Nothing renders until the
 * first open. Deliberately NOT Radix Dialog: its modal lock (body
 * pointer-events / scroll) is tied to MOUNT, not to `open` — a force-mounted
 * closed dialog freezes the whole page.
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

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!everOpened && !open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-50", !open && "hidden")} aria-hidden={!open}>
      {/* Backdrop — the canvas shows through; clicking it closes. */}
      <div
        className="absolute inset-0 bg-[var(--surface)]/85 backdrop-blur-sm"
        onClick={onClose}
        data-testid="workspace-overlay-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] card",
          "flex h-[90vh] w-[94vw] flex-col gap-4 p-6",
          size === "wide" ? "max-w-5xl" : "max-w-3xl",
          "max-lg:h-dvh max-lg:w-screen max-lg:max-w-none max-lg:rounded-none max-lg:p-4",
        )}
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <h2
          className="display shrink-0 text-[26px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
