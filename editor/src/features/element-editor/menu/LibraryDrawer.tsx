import { Library } from "@/features/canvas/Library";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function LibraryDrawer({ open, onOpenChange }: Props) {
  if (!open) return null;
  return (
    <>
      <div
        data-testid="library-drawer-overlay"
        className="fixed inset-0 z-40 bg-black/30"
        onClick={() => onOpenChange(false)}
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-[100dvh] w-[320px] flex-col border-l border-[var(--line)] bg-[var(--bg)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[52px] shrink-0 border-b border-[var(--line-soft)] px-3 flex items-center font-mono text-[13px]">
          Library
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <Library />
        </div>
      </aside>
    </>
  );
}
