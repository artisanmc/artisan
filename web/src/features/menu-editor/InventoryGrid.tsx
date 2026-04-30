import { cx } from "@/lib/cx";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { useDroppable } from "@dnd-kit/core";

function Slot({ position }: { position: number }) {
  const draft = useMenuDraftStore((s) => s.draft);
  const selected = useMenuDraftStore((s) => s.selectedPosition);
  const select = useMenuDraftStore((s) => s.selectPosition);
  const { isOver, setNodeRef } = useDroppable({
    id: `slot:${position}`,
    data: { kind: "slot", position },
  });

  const element = draft?.layers
    .flatMap((l) => l.elements)
    .find((e) => e.positions === String(position));
  const filled = Boolean(element?.appearances[0]?.material);
  const isSelected = selected === position;

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={() => select(position)}
      data-testid={`slot-${position}`}
      className={cx(
        "flex aspect-square items-center justify-center rounded border font-mono text-[10px] transition-colors",
        filled
          ? "border-zinc-600 bg-zinc-800 text-zinc-300"
          : "border-zinc-800 bg-zinc-900 text-zinc-600",
        isSelected && "ring-2 ring-emerald-500",
        isOver && "border-emerald-500 bg-emerald-900/30",
      )}
    >
      {element?.appearances[0]?.material?.slice(0, 6) ?? position}
    </button>
  );
}

export function InventoryGrid() {
  const draft = useMenuDraftStore((s) => s.draft);
  if (!draft) return <div className="p-8 text-zinc-500">No menu loaded</div>;
  const total = draft.rows * 9;
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="grid w-[480px] grid-cols-9 gap-1">
        {Array.from({ length: total }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
          <Slot key={i} position={i} />
        ))}
      </div>
    </div>
  );
}
