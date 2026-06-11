import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Restrict translation to the vertical axis so the workspace card can't be dragged sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
import type { PackId } from "@/domain/types";
import { type PackSummary, getNetwork, listNetworks } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { CSS } from "@dnd-kit/utilities";
import { Database, GripVertical, History, Languages, LayoutGrid } from "lucide-react";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { type ServerEntry, ServerSelector } from "./ServerSelector";
import { UserMenu } from "./UserMenu";

export function WorkspaceSidebar() {
  const { t } = useTranslation();
  const sessionToken = useSessionStore((s) => s.accessToken);
  const sessionNetworkId = useSessionStore((s) => s.networkId);
  const sessionServerKeyId = useSessionStore((s) => s.serverKeyId);
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);
  const storeRefreshToken = useNetworksStore((s) => s.refreshToken);
  const localPacks = useAccountStore((s) => s.account.packs);
  const packOrder = useAccountStore((s) => s.account.packOrder);
  const reorderPacks = useAccountStore((s) => s.reorderPacks);
  // distance: 5 — small movement before drag activates.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverPacks, setServerPacks] = useState<PackSummary[]>([]);
  const [allServerEntries, setAllServerEntries] = useState<ServerEntry[]>([]);
  const [refetchToken, setRefetchToken] = useState(0);

  // Session mode = trusted plugin session (via /artisan editor) without a
  // logged-in account. listNetworks / getNetwork would 401 in this mode
  // (cookie-auth only), so we skip those fetches and source packs from the
  // accountStore (populated by the WS sync) instead.
  const isSessionMode = !!sessionToken;

  // Active network + server: URL params first, then session bindings as
  // fallback (the trust dance pre-populates sessionStore with both).
  // Since the slug routes (phase 4a), URL params may carry slugs instead of
  // ids — resolve them to real ids here so all downstream matching (pack
  // filtering, link building) stays id-based.
  const urlParams = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const rawNetworkParam = urlParams.networkId ?? sessionNetworkId ?? networks[0]?.id ?? null;
  const activeNetworkId = rawNetworkParam
    ? (networks.find((n) => n.id === rawNetworkParam || n.slug === rawNetworkParam)?.id ??
      rawNetworkParam)
    : null;
  const rawServerParam = urlParams.serverId ?? sessionServerKeyId ?? null;
  // Server slugs are only unique per network ("server" exists in many) — scope
  // the lookup to the active network or a slug could resolve to another
  // network's server and the workspace list would filter to the wrong packs.
  const activeServerId = rawServerParam
    ? (allServerEntries.find(
        (e) =>
          (activeNetworkId == null || e.networkId === activeNetworkId) &&
          (e.serverId === rawServerParam || e.serverSlug === rawServerParam),
      )?.serverId ?? rawServerParam)
    : null;

  useEffect(() => {
    if (isSessionMode) return; // listNetworks needs cookie auth
    // Refetch on refresh bump too — a network created in the wizard/hub would
    // otherwise never reach the store (only fetched when empty).
    if (networks.length === 0 || storeRefreshToken > 0) {
      listNetworks()
        .then(setNetworks)
        .catch(() => {});
    }
  }, [isSessionMode, storeRefreshToken]);

  // Fetch all server entries across all networks + packs for the active network.
  useEffect(() => {
    if (isSessionMode) {
      // Session mode: no network listing available. Packs come from accountStore.
      setAllServerEntries([]);
      setServerPacks([]);
      return;
    }
    if (networks.length === 0) {
      setAllServerEntries([]);
      setServerPacks([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      networks.map((n) =>
        getNetwork(n.id).then((d) => ({ network: n, serverKeys: d.serverKeys, packs: d.packs })),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const entries: ServerEntry[] = results.flatMap((r) =>
          r.serverKeys.map((sk) => ({
            serverId: sk.id,
            serverSlug: sk.slug,
            serverLabel: displayServerLabel(sk),
            networkId: r.network.id,
            networkSlug: r.network.slug,
            networkName: r.network.name,
          })),
        );
        setAllServerEntries(entries);
        // Update packs from the active network result
        const activeResult = results.find((r) => r.network.id === activeNetworkId);
        if (activeResult) {
          setServerPacks(activeResult.packs);
        } else {
          setServerPacks([]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllServerEntries([]);
          setServerPacks([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [networks, activeNetworkId, refetchToken, storeRefreshToken, isSessionMode]);

  const serverIds = new Set(serverPacks.map((p) => p.id));
  const optimisticEntries: PackSummary[] = localPacks
    .filter((p) => !serverIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: "", // optimistic local entry; slug not used for the sidebar link (id-based)
      hash: "",
      updatedAt: p.updatedAt,
      networkId: (p as unknown as { networkId?: string }).networkId ?? "",
      serverKeyId: (p as unknown as { serverKeyId?: string }).serverKeyId ?? "",
    }));
  const allPacks = [...serverPacks, ...optimisticEntries];

  // Filter by active server (URL-driven). In session mode, accountStore.packs
  // is already implicitly scoped to the session's server (no other source) —
  // skip the filter so packs that lack serverKeyId metadata still show.
  const filteredServerPacks = isSessionMode
    ? allPacks
    : activeServerId
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
      <Link
        to="/networks"
        onClick={() => useSidebarStore.getState().close()}
        className="flex items-center gap-2.5 rounded-[10px] px-1.5 pt-1 pb-0.5 transition-colors hover:bg-[var(--surface-hover)]"
      >
        <span className="pixel-mark">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span
          className="font-display text-[17px] font-semibold text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("sidebar.brand")}
        </span>
      </Link>

      {!isSessionMode && <ServerSelector servers={allServerEntries} />}

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
                    <SortableWorkspaceItem
                      key={w.id}
                      id={w.id}
                      name={w.name}
                      networkId={w.networkId || activeNetworkId}
                      serverId={w.serverKeyId || activeServerId}
                    />
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

function SortableWorkspaceItem({
  id,
  name,
  networkId,
  serverId,
}: {
  id: string;
  name: string;
  networkId: string | null;
  serverId: string | null;
}) {
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

  // Build link target — prefer new URL when we have network+server context.
  const linkTo =
    networkId && serverId
      ? "/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
      : "/workspace/$workspaceId";
  const linkParams =
    networkId && serverId ? { networkId, serverId, workspaceId: id } : { workspaceId: id };

  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
      <div className="group flex items-stretch gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <Link
          to={linkTo as any}
          params={linkParams as any}
          onClick={() => useSidebarStore.getState().close()}
          className={
            isActiveWorkspace
              ? "flex flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-semibold text-white transition-colors [&_svg]:text-[var(--brand)]"
              : "flex flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
          }
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
      {isActiveWorkspace && (
        <WorkspaceSubTabs workspaceId={id} networkId={networkId} serverId={serverId} />
      )}
    </li>
  );
}

function WorkspaceSubTabs({
  workspaceId,
  networkId,
  serverId,
}: {
  workspaceId: string;
  networkId: string | null;
  serverId: string | null;
}) {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { tab?: string } | undefined;
  const currentTab = search?.tab ?? "overview";
  const tabs = [
    { id: "overview", label: t("workspace.tabs.overview"), Icon: LayoutGrid },
    { id: "translations", label: t("workspace.tabs.translations"), Icon: Languages },
    { id: "data-sources", label: t("workspace.tabs.dataSources"), Icon: Database },
    { id: "history", label: t("workspace.tabs.history"), Icon: History },
  ] as const;

  const tabLinkTo =
    networkId && serverId
      ? "/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
      : "/workspace/$workspaceId";
  const tabLinkParams =
    networkId && serverId ? { networkId, serverId, workspaceId } : { workspaceId };

  return (
    <ul className="mt-0.5 mb-1 flex flex-col gap-0.5">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        const Icon = tab.Icon;
        return (
          <li key={tab.id}>
            <Link
              to={tabLinkTo as any}
              params={tabLinkParams as any}
              search={{ tab: tab.id } as any}
              className={
                isActive
                  ? "flex items-center gap-2 rounded-[10px] bg-[var(--brand-soft)] py-2 pl-6 pr-2.5 text-[13px] font-semibold text-[var(--brand)]"
                  : "flex items-center gap-2 rounded-[10px] py-2 pl-6 pr-2.5 text-[13px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
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
