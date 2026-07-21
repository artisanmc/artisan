import { cn } from "@/lib/cx";
import { X } from "lucide-react";
import * as React from "react";

/**
 * In-flow secondary view for the workspace (Translations, Data sources,
 * History, AI assistant). REPLACES the canvas in the center region rather than
 * floating above it as a modal: an opaque panel absolutely filling its
 * (relative) parent. The canvas stays MOUNTED underneath (never display:none)
 * so Konva keeps its measured size — the panel simply covers it. Which view is
 * active is driven by `?tab=` and surfaced by the topbar's segmented nav.
 *
 * KEEP-ALIVE: mounts on first activation and stays MOUNTED (hidden) afterwards
 * so the view's state — translation filters, an in-flight assistant chat, the
 * selected data source — survives leave/return. Nothing renders until the first
 * activation.
 */
export function WorkspaceView({
  active,
  onExit,
  title,
  children,
}: {
  active: boolean;
  onExit: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // Render-time latch: flips once on the first activation and never back — the
  // keep-alive gate.
  const [everActive, setEverActive] = React.useState(false);
  if (active && !everActive) setEverActive(true);

  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onExit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onExit]);

  if (!everActive) return null;

  return (
    <div
      role="tabpanel"
      aria-label={title}
      data-testid="workspace-view"
      className={cn(
        // z-30 clears the canvas DOM overlays (CanvasToolbar / ArmedBanner at
        // z-20) so the opaque panel fully covers the canvas underneath.
        "absolute inset-0 z-30 flex flex-col gap-4 bg-[var(--surface)] p-6 max-lg:p-4",
        !active && "hidden",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-4">
        <h2
          className="display text-[26px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onExit}
          className="rounded-md p-1 text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
