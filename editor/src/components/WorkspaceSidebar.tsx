import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DndContext, type DragEndEvent, type Modifier, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";

/** Restrict translation to the vertical axis so the workspace card can't be dragged sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
import { CSS } from "@dnd-kit/utilities";
import { Database, GripVertical, History, Languages, LayoutGrid } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { NetworkDropdown } from "./NetworkDropdown";
import { ServerDropdown } from "./ServerDropdown";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useSidebarStore } from "@/state/sidebarStore";
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
  // distance: 5 — small movement before drag activates. Click-on-the-row is
  // safe because the drag handle is a sibling, not an overlay, so the row
  // Link and the handle live in distinct hit areas.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverPacks, setServerPacks] = useState<PackSummary[]>([]);
  const [networkServers, setNetworkServers] = useState<{ id: string; label: string | null }[]>([]);
  const [refetchToken, setRefetchToken] = useState(0);
  const activeServerId = useServersStore((s) => s.activeServerId);

  useEffect(() => {
    if (networks.length === 0) {
      listNetworks().then(setNetworks).catch(() => {});
    }
  }, []);

  // Active network = session network (set after /artisan setup), otherwise
  // the user's picked one in the NetworkDropdown (persisted), otherwise the
  // first owned network. Null when the user has no networks at all.
  const browseActiveId = useNetworksStore((s) => s.activeId);
  const activeNetworkId = useMemo(
    () => sessionNetworkId ?? browseActiveId ?? networks[0]?.id ?? null,
    [sessionNetworkId, browseActiveId, networks],
  );

  useEffect(() => {
    if (!activeNetworkId) {
      setServerPacks([]);
      setNetworkServers([]);
      return;
    }
    let cancelled = false;
    const refetch = () => {
      getNetwork(activeNetworkId)
        .then((d) => {
          if (!cancelled) {
            setServerPacks(d.packs);
            setNetworkServers(d.serverKeys.map((s) => ({ id: s.id, label: s.label })));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setServerPacks([]);
            setNetworkServers([]);
          }
        });
    };
    refetch();
    return () => {
      cancelled = true;
    };
  }, [activeNetworkId, refetchToken]);

  const serverIds = new Set(serverPacks.map((p) => p.id));
  const optimisticEntries: PackSummary[] = localPacks
    .filter((p) => !serverIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }));
  const allPacks = [...serverPacks, ...optimisticEntries];

  // When a server is actively selected and the network has ≥2 servers, filter
  // packs to only those owned by that server. Single-server networks show all.
  const filteredServerPacks =
    activeServerId && networkServers.length >= 2
      ? allPacks.filter((p) => p.serverKeyId === activeServerId)
      : allPacks;

  const idToPack = new Map(filteredServerPacks.map((p) => [p.id, p]));
  const ordered: PackSummary[] = [];
  for (const id of packOrder) {
    const p = idToPack.get(id);
    if (p) {
      ordered.push(p);
      idToPack.delete(id);
    }
  }
  // Sort packs that aren't in packOrder by id (stable, deterministic). We
  // deliberately do NOT sort by updatedAt — that timestamp gets bumped on
  // every navigation/autosave, which made workspaces yank to the top each
  // time the user clicked them.
  const remaining = [...idToPack.values()].sort((a, b) => a.id.localeCompare(b.id));
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
    <nav className="flex h-full flex-col gap-3.5 px-3 py-3.5">
      <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-0.5">
        <span className="pixel-mark">
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </span>
        <span className="font-display text-[17px] font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          {t("sidebar.brand")}
        </span>
      </div>

      <NetworkDropdown />
      <ServerDropdown servers={networkServers} />

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {activeNetworkId ? (
          <div className="flex flex-col">
            <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
              {t("sidebar.myWorkspaces")}
            </div>
            <DndContext
              sensors={sensors}
              onDragEnd={onDragEnd}
              modifiers={[restrictToVerticalAxis]}
            >
              <SortableContext
                items={finalList.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col">
                  {finalList.map((w) => (
                    <SortableWorkspaceItem key={w.id} id={w.id} name={w.name} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <NewWorkspaceDialog
              networkId={activeNetworkId}
              serverKeyId={activeServerId}
              onCreated={() => setRefetchToken((n) => n + 1)}
              trigger={
                <button
                  type="button"
                  className="mt-1 block w-full cursor-pointer rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  {t("sidebar.newWorkspace")}
                </button>
              }
            />
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-[11.5px] leading-relaxed text-[var(--text-mut)]">
            {t("sidebar.noNetworkHint")}
          </div>
        )}

        <div className="mt-4 flex flex-col">
          <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.installedModules")}
          </div>
          <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--text-faint)]">
            {t("sidebar.noModules")}
          </div>
        </div>
      </div>

      <UserMenu />
    </nav>
  );
}

function SortableWorkspaceItem({ id, name }: { id: string; name: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const params = useParams({ strict: false }) as { workspaceId?: string };
  const isActiveWorkspace = params.workspaceId === id;
  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
      <div
        data-active={isActiveWorkspace ? "true" : "false"}
        className="group flex items-stretch gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)] data-[active=true]:bg-[var(--brand-soft)] data-[active=true]:hover:bg-[var(--brand-soft)]"
      >
        <Link
          to="/workspace/$workspaceId"
          params={{ workspaceId: id }}
          onClick={() => useSidebarStore.getState().close()}
          className="flex flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)] data-[status=active]:font-semibold data-[status=active]:text-white data-[status=active]:[&_svg]:text-[var(--brand)]"
        >
          <LayoutGrid className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          <span className="truncate flex-1">{name}</span>
        </Link>
        <button
          type="button"
          aria-label="Reorder workspace"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex h-auto w-6 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-faint)] transition-opacity hover:text-[var(--text-mut)] active:cursor-grabbing lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100"
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>
      {isActiveWorkspace && <WorkspaceSubTabs workspaceId={id} />}
    </li>
  );
}

function WorkspaceSubTabs({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { tab?: string } | undefined;
  const currentTab = search?.tab ?? "overview";
  const tabs = [
    { id: "overview", label: t("workspace.tabs.overview"), Icon: LayoutGrid },
    { id: "translations", label: t("workspace.tabs.translations"), Icon: Languages },
    { id: "data-sources", label: t("workspace.tabs.dataSources"), Icon: Database },
    { id: "history", label: t("workspace.tabs.history"), Icon: History },
  ] as const;
  return (
    <ul className="ml-[17px] mt-1 mb-1 flex flex-col gap-0.5 border-l border-[var(--border-soft)] pl-[18px]">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        const Icon = tab.Icon;
        return (
          <li key={tab.id}>
            <Link
              to="/workspace/$workspaceId"
              params={{ workspaceId }}
              search={{ tab: tab.id }}
              className={
                isActive
                  ? "flex items-center gap-2 rounded-[8px] bg-[var(--brand-soft)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--brand)]"
                  : "flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }
            >
              <Icon className="size-[13px] shrink-0" />
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
