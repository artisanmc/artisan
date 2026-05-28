import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NetworkDropdown } from "./NetworkDropdown";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { getNetwork, listNetworks, type PackSummary } from "@/lib/api/networks";
import type { PackId } from "@/domain/types";

export function WorkspaceSidebar() {
  const { t } = useTranslation();
  const sessionNetworkId = useSessionStore((s) => s.networkId);
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);
  const localPacks = useAccountStore((s) => s.account.packs);
  const packOrder = useAccountStore((s) => s.account.packOrder);
  const reorderPacks = useAccountStore((s) => s.reorderPacks);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverPacks, setServerPacks] = useState<PackSummary[]>([]);
  const [refetchToken, setRefetchToken] = useState(0);

  // Load networks once on mount if not already populated (covers user-mode
  // visiting a workspace deeplink without going through /account first).
  useEffect(() => {
    if (networks.length === 0) {
      listNetworks().then(setNetworks).catch(() => {});
    }
  }, []);

  // Active network = session network (set after /artisan setup), otherwise first
  // network in the user's membership list. Null when the user has no networks
  // at all (fresh signup before any setup).
  const activeNetworkId = useMemo(
    () => sessionNetworkId ?? networks[0]?.id ?? null,
    [sessionNetworkId, networks],
  );

  useEffect(() => {
    if (!activeNetworkId) {
      setServerPacks([]);
      return;
    }
    let cancelled = false;
    const refetch = () => {
      getNetwork(activeNetworkId)
        .then((d) => {
          if (!cancelled) setServerPacks(d.packs);
        })
        .catch(() => {
          if (!cancelled) setServerPacks([]);
        });
    };
    refetch();
    return () => {
      cancelled = true;
    };
  }, [activeNetworkId, refetchToken]);

  // Server packs + local-only optimistic packs (just-created via session mode
  // autosave, not yet flushed). User-mode pack creation goes through
  // NewWorkspaceDialog → backend API → setRefetchToken bumps the effect.
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

      <div className="flex-1 overflow-auto">
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
          {activeNetworkId ? (
            <NewWorkspaceDialog
              networkId={activeNetworkId}
              onCreated={() => setRefetchToken((n) => n + 1)}
              trigger={
                <button
                  type="button"
                  className="mt-1 block w-full px-2 py-1 text-left text-xs text-zinc-400 hover:text-zinc-200"
                >
                  + Nouveau workspace
                </button>
              }
            />
          ) : (
            <div className="mt-1 px-2 py-1 text-[11px] text-zinc-500">
              Crée un Network ou lance <code>/artisan setup</code> sur ton serveur pour commencer.
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Modules installés
          </div>
          <div className="rounded border border-dashed border-zinc-800 px-2 py-2 text-[11px] text-zinc-500">
            Aucun module installé.
          </div>
        </div>
      </div>

      <Link
        to="/settings"
        className="flex items-center gap-2 rounded px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
      >
        <span>⚙</span>
        <span>{t("sidebar.settings")}</span>
      </Link>
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
