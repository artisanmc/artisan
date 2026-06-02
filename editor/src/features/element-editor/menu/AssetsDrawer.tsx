import type { PackId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  packId: PackId;
}

export function AssetsDrawer({ open, onOpenChange, packId }: Props) {
  if (!open) return null;
  return (
    <>
      <div
        data-testid="assets-drawer-overlay"
        className="fixed inset-0 z-40 bg-black/30"
        onClick={() => onOpenChange(false)}
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-[100dvh] w-[360px] flex-col border-l border-[var(--line)] bg-[var(--bg)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[52px] shrink-0 border-b border-[var(--line-soft)] px-3 flex items-center font-mono text-[13px]">
          Assets
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <AssetsTab packId={packId} />
        </div>
      </aside>
    </>
  );
}
