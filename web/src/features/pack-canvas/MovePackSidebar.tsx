import type { PackId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useAccountStore } from "@/state/accountStore";
import { useDroppable } from "@dnd-kit/core";

interface DropTargetProps {
  packId: PackId;
  name: string;
}

function DropTarget({ packId, name }: DropTargetProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `pack-target:${packId}`, data: { packId } });
  return (
    <div
      ref={setNodeRef}
      data-testid={`drop-target-${packId}`}
      className={cx(
        "rounded-md border px-3 py-2 font-mono text-sm",
        isOver ? "border-emerald-500 bg-emerald-900/40" : "border-zinc-700",
      )}
    >
      {name}
    </div>
  );
}

interface MovePackSidebarProps {
  currentPackId: PackId;
}

export function MovePackSidebar({ currentPackId }: MovePackSidebarProps) {
  const packs = useAccountStore((s) => s.account.packs);
  const others = packs.filter((p) => p.id !== currentPackId);
  if (others.length === 0) return null;
  return (
    <aside className="flex w-56 flex-col gap-2 border-l border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-1 text-xs uppercase text-zinc-500">Drop to move</div>
      {others.map((p) => (
        <DropTarget key={p.id} packId={p.id} name={p.name} />
      ))}
    </aside>
  );
}
