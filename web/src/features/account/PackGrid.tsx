import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { NewPackDialog } from "./NewPackDialog";
import { PackCard } from "./PackCard";

export function PackGrid() {
  const account = useAccountStore((s) => s.account);
  const reorderPacks = useAccountStore((s) => s.reorderPacks);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const orderedPacks = account.packOrder
    .map((id) => account.packs.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = account.packOrder.indexOf(active.id as PackId);
    const newIndex = account.packOrder.indexOf(over.id as PackId);
    reorderPacks(arrayMove(account.packOrder, oldIndex, newIndex));
  };

  return (
    <div className="p-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-semibold text-2xl">Packs</h1>
        <NewPackDialog />
      </header>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={account.packOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orderedPacks.map((pack) => (
              <PackCard key={pack.id} pack={pack} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
