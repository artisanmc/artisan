import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NetworkDropdown } from "./NetworkDropdown";
import { NewPackDialog } from "@/features/account/NewPackDialog";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";
import { getNetwork, type PackSummary } from "@/lib/api/networks";
import type { PackId } from "@/domain/types";

export function WorkspaceSidebar() {
  const networkId = useSessionStore((s) => s.networkId);
  const localPacks = useAccountStore((s) => s.account.packs);
  const packOrder = useAccountStore((s) => s.account.packOrder);
  const reorderPacks = useAccountStore((s) => s.reorderPacks);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverPacks, setServerPacks] = useState<PackSummary[]>([]);

  useEffect(() => {
    if (!networkId) {
      setServerPacks([]);
      return;
    }
    let cancelled = false;
    const refetch = () => {
      getNetwork(networkId)
        .then((d) => {
          if (!cancelled) setServerPacks(d.packs);
        })
        .catch(() => {
          if (!cancelled) setServerPacks([]);
        });
    };
    refetch();

    let prevLen = useAccountStore.getState().account.packs.length;
    const unsub = useAccountStore.subscribe((state) => {
      const newLen = state.account.packs.length;
      if (newLen !== prevLen) {
        prevLen = newLen;
        setTimeout(refetch, 2500);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [networkId]);

  // Server packs + local-only optimistic packs (just-created, not yet synced).
  const serverIds = new Set(serverPacks.map((p) => p.id));
  const optimisticEntries: PackSummary[] = localPacks
    .filter((p) => !serverIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }));
  const allPacks = [...serverPacks, ...optimisticEntries];

  // Ordering: follow account.packOrder where possible, append remaining by updatedAt desc.
  const idToPack = new Map(allPacks.map((p) => [p.id, p]));
  const ordered: PackSummary[] = [];
  for (const id of packOrder) {
    const p = idToPack.get(id);
    if (p) {
      ordered.push(p);
      idToPack.delete(id);
    }
  }
  const remaining = [...idToPack.values()].sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
  const finalList = [...ordered, ...remaining];

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = finalList.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderPacks(arrayMove(ids, oldIndex, newIndex) as PackId[]);
  };

  return (
    <nav className="flex h-full flex-col gap-3 p-2">
      <NetworkDropdown />

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Mes Workspaces
        </div>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext items={finalList.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-0.5">
              {finalList.map((w) => (
                <SortableWorkspaceItem key={w.id} id={w.id} name={w.name} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <NewPackDialog
          trigger={
            <button
              type="button"
              className="mt-1 block w-full px-2 py-1 text-left text-xs text-zinc-400 hover:text-zinc-200"
            >
              + Nouveau workspace
            </button>
          }
        />
      </div>

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Modules installés
        </div>
        <div className="rounded border border-dashed border-zinc-800 px-2 py-2 text-[11px] text-zinc-500">
          Aucun module installé.
        </div>
      </div>
    </nav>
  );
}

function SortableWorkspaceItem({ id, name }: { id: string; name: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} className="group relative">
      <Link
        to="/workspace/$workspaceId"
        params={{ workspaceId: id }}
        className="block rounded px-2 py-1 pr-7 text-sm text-zinc-200 hover:bg-zinc-800"
        activeProps={{ className: "block rounded bg-zinc-800 px-2 py-1 pr-7 text-sm text-zinc-100" }}
      >
        {name}
      </Link>
      <button
        type="button"
        aria-label="Reorder workspace"
        {...attributes}
        {...listeners}
        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-5 w-5 cursor-grab items-center justify-center rounded text-[10px] text-zinc-500 active:cursor-grabbing lg:opacity-0 lg:group-hover:opacity-100"
      >
        ⠿
      </button>
    </li>
  );
}
