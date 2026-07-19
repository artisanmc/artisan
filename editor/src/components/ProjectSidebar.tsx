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
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Restrict translation to the vertical axis so the workspace card can't be dragged sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
import { selectModuleNavEntries } from "@/distribution/moduleNav";
import type { ProjectId } from "@/domain/types";
import { type ProjectSummary, getNetwork, listNetworks } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAccountStore } from "@/state/accountStore";
import { useModulesStore } from "@/state/modulesStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, GripVertical, LayoutGrid } from "lucide-react";
import { NewProjectDialog } from "./NewProjectDialog";
import { type ServerEntry, ServerSelector } from "./ServerSelector";
import { UserMenu } from "./UserMenu";

export function ProjectSidebar() {
  const { t } = useTranslation();
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);
  const storeRefreshToken = useNetworksStore((s) => s.refreshToken);
  const localProjects = useAccountStore((s) => s.account.projects);
  const projectOrder = useAccountStore((s) => s.account.projectOrder);
  const reorderProjects = useAccountStore((s) => s.reorderProjects);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
  const moduleNav = selectModuleNavEntries(mountedModuleIds);
  // distance: 5 — small movement before drag activates.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverProjects, setServerProjects] = useState<ProjectSummary[]>([]);
  const [allServerEntries, setAllServerEntries] = useState<ServerEntry[]>([]);
  const [refetchToken, setRefetchToken] = useState(0);

  // Active network + server: URL params first, then persisted selection.
  // Since the slug routes (phase 4a), URL params may carry slugs instead of
  // ids — resolve them to real ids here so all downstream matching (pack
  // filtering, link building) stays id-based.
  // Routes without params (settings, credits…) fall back to the persisted
  // selection (stores) so navigating there doesn't silently "deselect" the
  // server while the project list stays scoped to it.
  const storedNetworkId = useNetworksStore((s) => s.activeId);
  const storedServerId = useServersStore((s) => s.activeServerId);
  const urlParams = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const rawNetworkParam = urlParams.networkId ?? storedNetworkId ?? networks[0]?.id ?? null;
  const activeNetworkId = rawNetworkParam
    ? (networks.find((n) => n.id === rawNetworkParam || n.slug === rawNetworkParam)?.id ??
      rawNetworkParam)
    : null;
  // Only trust the persisted server if it still exists in the active network —
  // a deleted server must not filter the project list down to nothing.
  const storedServerValid =
    storedServerId != null &&
    allServerEntries.some(
      (e) =>
        e.serverId === storedServerId &&
        (activeNetworkId == null || e.networkId === activeNetworkId),
    );
  const rawServerParam = urlParams.serverId ?? (storedServerValid ? storedServerId : null);
  const activeNetworkName = activeNetworkId
    ? (networks.find((n) => n.id === activeNetworkId)?.name ?? null)
    : null;
  // Server slugs are only unique per network ("server" exists in many) — scope
  // the lookup to the active network or a slug could resolve to another
  // network's server and the workspace list would filter to the wrong projects.
  const activeServerId = rawServerParam
    ? (allServerEntries.find(
        (e) =>
          (activeNetworkId == null || e.networkId === activeNetworkId) &&
          (e.serverId === rawServerParam || e.serverSlug === rawServerParam),
      )?.serverId ?? rawServerParam)
    : null;

  // Persist the URL-driven selection so param-less routes keep it. Only store
  // resolved ids (never raw slugs) — the entry lookup guarantees that.
  useEffect(() => {
    if (urlParams.networkId && activeNetworkId && networks.some((n) => n.id === activeNetworkId)) {
      if (useNetworksStore.getState().activeId !== activeNetworkId) {
        useNetworksStore.getState().setActiveId(activeNetworkId);
      }
    }
    if (urlParams.serverId) {
      const resolved = allServerEntries.find(
        (e) =>
          (activeNetworkId == null || e.networkId === activeNetworkId) &&
          (e.serverId === urlParams.serverId || e.serverSlug === urlParams.serverId),
      )?.serverId;
      if (resolved && useServersStore.getState().activeServerId !== resolved) {
        useServersStore.getState().setActiveServerId(resolved);
      }
    }
  }, [urlParams.networkId, urlParams.serverId, activeNetworkId, networks, allServerEntries]);

  useEffect(() => {
    // Refetch on refresh bump too — a network created in the wizard/hub would
    // otherwise never reach the store (only fetched when empty).
    if (networks.length === 0 || storeRefreshToken > 0) {
      listNetworks()
        .then(setNetworks)
        .catch(() => {});
    }
  }, [storeRefreshToken]);

  // Fetch all server entries across all networks + projects for the active network.
  useEffect(() => {
    if (networks.length === 0) {
      setAllServerEntries([]);
      setServerProjects([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      networks.map((n) =>
        getNetwork(n.id).then((d) => ({
          network: n,
          serverKeys: d.serverKeys,
          projects: d.projects,
        })),
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
        // Update projects from the active network result
        const activeResult = results.find((r) => r.network.id === activeNetworkId);
        if (activeResult) {
          setServerProjects(activeResult.projects);
        } else {
          setServerProjects([]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllServerEntries([]);
          setServerProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [networks, activeNetworkId, refetchToken, storeRefreshToken]);

  const serverIds = new Set(serverProjects.map((p) => p.id));
  const optimisticEntries: ProjectSummary[] = localProjects
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
  const allProjects = [...serverProjects, ...optimisticEntries];

  // Filter by active server (URL-driven).
  const filteredServerProjects = activeServerId
    ? allProjects.filter((p) => p.serverKeyId === activeServerId)
    : allProjects;

  const idToProject = new Map(filteredServerProjects.map((p) => [p.id, p]));
  const ordered: ProjectSummary[] = [];
  for (const id of projectOrder) {
    const p = idToProject.get(id);
    if (p) {
      ordered.push(p);
      idToProject.delete(id);
    }
  }
  const remaining = [...idToProject.values()].sort((a, b) => a.id.localeCompare(b.id));
  const finalList = [...ordered, ...remaining];

  // Element count per pack: prefer the live count from a fully-loaded pack in
  // the account store (updates as the user edits), else the summary's
  // backend-computed documentCount. Null when neither is available.
  const liveCount = new Map(
    localProjects.map((p) => [p.id, p.menus.length + p.commands.length + p.dialogs.length]),
  );
  const countFor = (p: ProjectSummary): number | null =>
    liveCount.get(p.id as ProjectId) ?? p.documentCount ?? null;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = finalList.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderProjects(arrayMove(ids, oldIndex, newIndex) as ProjectId[]);
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

      <ServerSelector servers={allServerEntries} />

      {activeNetworkId && activeNetworkName && (
        <Link
          to="/networks/$networkId"
          params={{ networkId: activeNetworkId }}
          onClick={() => useSidebarStore.getState().close()}
          className="-mt-2 flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-[11.5px] text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <span className="truncate">{activeNetworkName}</span>
          <ArrowRight className="size-3 shrink-0" />
        </Link>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {activeNetworkId ? (
          <div className="flex flex-col">
            <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
              {t("sidebar.myProjects")}
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
                    <SortableProjectItem
                      key={w.id}
                      id={w.id}
                      name={w.name}
                      count={countFor(w)}
                      networkId={w.networkId || activeNetworkId}
                      serverId={w.serverKeyId || activeServerId}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <NewProjectDialog
              networkId={activeNetworkId}
              serverKeyId={activeServerId}
              onCreated={() => setRefetchToken((n) => n + 1)}
              trigger={
                <button
                  type="button"
                  className="mt-1 block w-full cursor-pointer rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  {t("sidebar.newProject")}
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
          {moduleNav.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--text-faint)]">
              {t("sidebar.noModules")}
            </div>
          ) : (
            <ul className="flex flex-col">
              {moduleNav.map((m) => (
                <li key={m.id}>
                  {/* TODO(P2): render m.sidebar.icon once modules ship real icons */}
                  <Link
                    to="/m/$moduleId"
                    params={{ moduleId: m.id }}
                    onClick={() => useSidebarStore.getState().close()}
                    className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  >
                    <span className="truncate flex-1">{m.sidebar.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <UserMenu />
    </nav>
  );
}

function SortableProjectItem({
  id,
  name,
  count,
  networkId,
  serverId,
}: {
  id: string;
  name: string;
  count: number | null;
  networkId: string | null;
  serverId: string | null;
}) {
  const { t } = useTranslation();
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
  const params = useParams({ strict: false }) as { projectId?: string };
  const isActiveProject = params.projectId === id;

  // Build link target — prefer new URL when we have network+server context.
  const linkTo =
    networkId && serverId
      ? "/networks/$networkId/servers/$serverId/projects/$projectId"
      : "/project/$projectId";
  const linkParams =
    networkId && serverId ? { networkId, serverId, projectId: id } : { projectId: id };

  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
      <div className="group flex items-stretch gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <Link
          to={linkTo as any}
          params={linkParams as any}
          onClick={() => useSidebarStore.getState().close()}
          className={
            isActiveProject
              ? "flex flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-semibold text-white transition-colors [&_svg]:text-[var(--brand)]"
              : "flex flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
          }
        >
          <LayoutGrid className="size-[15px] shrink-0 text-[var(--text-faint)]" />
          <span className="truncate flex-1">{name}</span>
          {count != null && (
            <span
              title={t("serverDetail.documentCount", { count })}
              aria-label={t("serverDetail.documentCount", { count })}
              className="shrink-0 rounded-full bg-[var(--surface-raised)] px-1.5 text-[10px] font-medium tabular-nums text-[var(--text-faint)]"
            >
              {count}
            </span>
          )}
        </Link>
        <button
          type="button"
          aria-label="Reorder project"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex h-auto w-6 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-faint)] transition-opacity hover:text-[var(--text-mut)] active:cursor-grabbing lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100"
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>

    </li>
  );
}


