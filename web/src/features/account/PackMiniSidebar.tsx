import { Button } from "@/components/ui/button";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { NewPackDialog } from "./NewPackDialog";
import { PackMini } from "./PackMini";

interface PackMiniSidebarProps {
  activePackId: PackId;
}

export function PackMiniSidebar({ activePackId }: PackMiniSidebarProps) {
  const account = useAccountStore((s) => s.account);
  const reorderPacks = useAccountStore((s) => s.reorderPacks);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const orderedPacks = account.packOrder
    .map((id) => account.packs.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = account.packOrder.indexOf(active.id as PackId);
    const newIndex = account.packOrder.indexOf(over.id as PackId);
    reorderPacks(arrayMove(account.packOrder, oldIndex, newIndex));
  };

  return (
    <aside
      data-pack-mini-sidebar="true"
      className="flex w-56 shrink-0 flex-col gap-2 border-r border-zinc-800 bg-zinc-950 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase text-zinc-500">Packs</span>
        <NewPackDialog
          trigger={
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-base leading-none">
              +
            </Button>
          }
        />
      </header>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={account.packOrder} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {orderedPacks.map((pack) => (
              <div key={pack.id} className="relative">
                <PackMini pack={pack} active={pack.id === activePackId} />
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </aside>
  );
}
