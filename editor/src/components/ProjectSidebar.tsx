import { ArtisanWordmark } from "@/components/ArtisanWordmark";
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
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Restrict translation to the vertical axis so the workspace card can't be dragged sideways. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
import type { ProjectId } from "@/domain/types";
import { buildProjectGroups, diskProjectsToSummaries } from "@/features/projects/projectGroups";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { type ProjectSummary, getNetwork, listNetworks } from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import { displayServerLabel } from "@/lib/serverLabel";
import { urlNetworkId, urlServerId } from "@/lib/urlIds";
import { useAccountStore } from "@/state/accountStore";
import { useModulesStore } from "@/state/modulesStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
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
  const serverScreens = useServerScreensStore((s) => s.screens);
  // distance: 5 — small movement before drag activates.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [serverProjects, setServerProjects] = useState<ProjectSummary[]>([]);
  // Trois états, comme la page d'un serveur : on lit, on a lu, on n'a pas pu
  // lire. Une liste vide affirmée pendant la lecture se lit comme un serveur
  // sans Projects, et le bouton de création invite alors à écrire sur un
  // disque qu'on ne joint pas.
  const [projectsStatus, setProjectsStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [allServerEntries, setAllServerEntries] = useState<ServerEntry[]>([]);
  const [refetchToken, setRefetchToken] = useState(0);

  // Active network + server: URL params first, then persisted selection.
  // Since the slug routes (phase 4a), URL params may carry slugs instead of
  // ids — resolve them to real ids here so all downstream matching (project
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

  // URL-facing forms: links carry slugs, everything else stays id-based.
  const netParam = urlNetworkId(networks, activeNetworkId);
  const srvParam = urlServerId(allServerEntries, activeNetworkId, activeServerId);

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

  // `networks.length` est lu comme condition, pas comme déclencheur : l'ajouter
  // en dépendance relancerait le fetch au retour de `setNetworks`, en boucle dès
  // que le refresh token est levé. Seul le bump doit déclencher.
  // biome-ignore lint/correctness/useExhaustiveDependencies: déclencheur volontairement limité au bump
  useEffect(() => {
    // Refetch on refresh bump too — a network created in the wizard/hub would
    // otherwise never reach the store (only fetched when empty).
    if (networks.length === 0 || storeRefreshToken > 0) {
      listNetworks()
        .then(setNetworks)
        .catch(() => {});
    }
  }, [storeRefreshToken]);

  /**
   * Les Projects du serveur actif, lus sur SON disque à chaque rafraîchissement.
   *
   * Le backend n'en tient plus de liste : elle se périmait au premier dossier
   * renommé ou supprimé (ADR `server-disk-only-storage`). Le nom du dossier EST
   * l'identité — le renommer le renomme dans l'éditeur, sans réconciliation.
   * Serveur hors ligne → on le dit (`projectsStatus`) : ses Projects ne sont
   * pas ouvrables, et rien ne sert d'inviter à en créer un de plus.
   */
  // `refetchToken` et `storeRefreshToken` ne sont pas lus dans l'effet : ce sont
  // justement les signaux « relis le disque » (Project créé, changement ailleurs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dépendances = signaux de rafraîchissement
  useEffect(() => {
    if (!activeNetworkId || !activeServerId) {
      setServerProjects([]);
      setProjectsStatus("loading");
      return;
    }
    let cancelled = false;
    setProjectsStatus("loading");
    listServerProjects(activeNetworkId, activeServerId).then((res) => {
      if (cancelled) return;
      setServerProjects(
        res.ok ? diskProjectsToSummaries(activeNetworkId, activeServerId, res.projectIds) : [],
      );
      setProjectsStatus(res.ok ? "ready" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [activeNetworkId, activeServerId, refetchToken, storeRefreshToken]);

  // Fetch all server entries across all networks.
  // Mêmes signaux de rafraîchissement que ci-dessus ; `activeNetworkId` re-scope
  // la liste quand on change de network sans que `networks` bouge.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dépendances = signaux de rafraîchissement
  useEffect(() => {
    if (networks.length === 0) {
      setAllServerEntries([]);
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
        // Share the slugs so every surface can build slug-based links.
        useServersStore.getState().setServers(entries);
        // La liste des Projects ne vient PLUS d'ici : elle se demande au disque
        // du serveur actif (effet ci-dessous). Les lignes en base ne décrivent
        // plus ce qui existe — elles ancrent ce que le backend possède
        // (assets, resource pack, conversations) — ADR `server-disk-only-storage`.
      })
      .catch(() => {
        if (!cancelled) setAllServerEntries([]);
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
  // Add-on-owned projects surface under "Installed modules", not the flat list
  // (ADR addon-owned-project-roots) — même regroupement que la page d'un
  // serveur, calculé une seule fois dans `buildProjectGroups`.
  const { flatProjects, moduleGroups } = buildProjectGroups({
    projects: finalList,
    screens: serverScreens,
    mountedModuleIds,
    localProjects,
  });

  // Nombre de Documents par Project : uniquement ceux qu'on a réellement ouverts
  // (compte vivant, il suit les éditions). Le `documentCount` calculé côté
  // backend est mort avec la copie des fichiers (ADR `server-disk-only-storage`)
  // — le recalculer coûterait une lecture disque par Project juste pour peupler
  // une sidebar. Un Project jamais ouvert n'affiche donc pas de badge.
  const liveCount = new Map(
    localProjects.map((p) => [p.id, p.menus.length + p.commands.length + p.dialogs.length]),
  );
  const countFor = (p: ProjectSummary): number | null => liveCount.get(p.id as ProjectId) ?? null;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = flatProjects.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderProjects(arrayMove(ids, oldIndex, newIndex) as ProjectId[]);
  };

  return (
    <nav className="flex h-full flex-col gap-3.5 px-3 py-2">
      <Link
        to="/networks"
        onClick={() => useSidebarStore.getState().close()}
        className="flex h-12 shrink-0 items-center gap-1 rounded-[10px] px-1.5 transition-colors hover:bg-[var(--surface-hover)]"
      >
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="size-7 shrink-0"
        />
        <ArtisanWordmark />
      </Link>

      <ServerSelector servers={allServerEntries} />

      {activeNetworkId && activeNetworkName && (
        <Link
          to="/networks/$networkId"
          params={{ networkId: netParam! }}
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
            {projectsStatus !== "ready" && (
              <div className="px-2.5 pb-1 text-[11.5px] text-[var(--text-faint)]">
                {projectsStatus === "loading"
                  ? t("sidebar.loadingProjects")
                  : t("sidebar.projectsUnavailable")}
              </div>
            )}
            <DndContext
              sensors={sensors}
              onDragEnd={onDragEnd}
              modifiers={[restrictToVerticalAxis]}
            >
              <SortableContext
                items={flatProjects.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col">
                  {flatProjects.map((w) => (
                    <SortableProjectItem
                      key={w.id}
                      id={w.id}
                      slug={w.slug}
                      name={w.name}
                      count={countFor(w)}
                      networkId={urlNetworkId(networks, w.networkId) || netParam}
                      serverId={
                        urlServerId(allServerEntries, w.networkId, w.serverKeyId) || srvParam
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            {projectsStatus === "ready" && (
              <NewProjectDialog
                networkId={netParam}
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
            )}
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
          {moduleGroups.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--text-faint)]">
              {t("sidebar.noModules")}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {moduleGroups.map((g) =>
                g.collapsed ? (
                  // One project, no screen (boutique) → a SINGLE entry named
                  // after the module that opens the editor directly.
                  <OwnedProjectItem
                    key={g.id}
                    id={g.projects[0]!.id}
                    slug={g.projects[0]!.slug}
                    name={g.label}
                    count={countFor(g.projects[0]!)}
                    networkId={urlNetworkId(networks, g.projects[0]!.networkId) || netParam}
                    serverId={
                      urlServerId(
                        allServerEntries,
                        g.projects[0]!.networkId,
                        g.projects[0]!.serverKeyId,
                      ) || srvParam
                    }
                  />
                ) : (
                  <li key={g.id} className="flex flex-col">
                    {/* TODO(P2): render the module's icon once modules ship real icons */}
                    <div className="px-2.5 pt-0.5 pb-1 text-[12px] font-semibold text-[var(--text)]">
                      {g.label}
                    </div>
                    <ul className="ml-3 flex flex-col border-l border-[var(--border)] pl-1">
                      {g.projects.map((w) => (
                        <OwnedProjectItem
                          key={w.id}
                          id={w.id}
                          slug={w.slug}
                          // Under a module group the canvas entry is "Éditeur"
                          // (ADR module-config-screens §2) — the group header
                          // already carries the module's name. Only a module
                          // owning several projects needs their real names.
                          name={g.projects.length === 1 ? t("screens.editorEntry") : w.name}
                          count={countFor(w)}
                          networkId={urlNetworkId(networks, w.networkId) || netParam}
                          serverId={
                            urlServerId(allServerEntries, w.networkId, w.serverKeyId) || srvParam
                          }
                        />
                      ))}
                      {g.screens.map((s) => (
                        <ScreenItem
                          key={s.id}
                          screen={s}
                          networkId={netParam}
                          serverId={srvParam}
                        />
                      ))}
                      {g.hasScreen && (
                        <li>
                          <Link
                            to="/m/$moduleId"
                            params={{ moduleId: g.id }}
                            onClick={() => useSidebarStore.getState().close()}
                            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                          >
                            <span className="truncate flex-1">{t("sidebar.configuration")}</span>
                          </Link>
                        </li>
                      )}
                    </ul>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>

      <UserMenu />
    </nav>
  );
}

/**
 * Le lien vers un Project, avec la seule décision qui varie : on a le contexte
 * network+serveur, ou pas. Les deux branches sont écrites en dur pour que le
 * routeur les type — le `to`/`params` calculé imposait deux `as any`, donc
 * aucune erreur de route n'était plus détectée ici.
 */
function ProjectLink({
  projectId,
  networkId,
  serverId,
  className,
  children,
}: {
  projectId: string;
  networkId: string | null;
  serverId: string | null;
  className: string;
  children: ReactNode;
}) {
  const close = () => useSidebarStore.getState().close();
  return networkId && serverId ? (
    <Link
      to="/networks/$networkId/servers/$serverId/projects/$projectId"
      params={{ networkId, serverId, projectId }}
      onClick={close}
      className={className}
    >
      {children}
    </Link>
  ) : (
    <Link to="/project/$projectId" params={{ projectId }} onClick={close} className={className}>
      {children}
    </Link>
  );
}

/** Module Config screen link under "Installed modules" (ADR module-config-screens). */
function ScreenItem({
  screen,
  networkId,
  serverId,
}: {
  screen: ServerEditorScreen;
  networkId: string | null;
  serverId: string | null;
}) {
  const params = useParams({ strict: false }) as { screenId?: string };
  const isActive = params.screenId === screen.id;
  if (!networkId || !serverId) return null;
  return (
    <li>
      <Link
        to="/networks/$networkId/servers/$serverId/screens/$screenId"
        params={{ networkId, serverId, screenId: screen.id }}
        onClick={() => useSidebarStore.getState().close()}
        className={
          isActive
            ? "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-semibold text-white transition-colors"
            : "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        }
      >
        <span className="truncate flex-1" title={screen.label}>
          {screen.label}
        </span>
      </Link>
    </li>
  );
}

/** Add-on-owned project link under "Installed modules" — like a project item but
 *  not reorderable (its placement is the module's, not the user's). */
function OwnedProjectItem({
  id,
  slug,
  name,
  count,
  networkId,
  serverId,
}: {
  id: string;
  /** URL form: project slugs are unique per server, so the link can carry one. */
  slug?: string;
  name: string;
  count: number | null;
  networkId: string | null;
  serverId: string | null;
}) {
  const { t } = useTranslation();
  const params = useParams({ strict: false }) as { projectId?: string };
  const isActiveProject = params.projectId === id || (!!slug && params.projectId === slug);
  return (
    <li className="flex flex-col">
      <ProjectLink
        projectId={slug || id}
        networkId={networkId}
        serverId={serverId}
        className={
          isActiveProject
            ? "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-semibold text-white transition-colors [&_svg]:text-[var(--brand)]"
            : "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        }
      >
        <span className="truncate flex-1" title={name}>
          {name}
        </span>
        {count != null && (
          <span
            title={t("serverDetail.documentCount", { count })}
            aria-label={t("serverDetail.documentCount", { count })}
            className="shrink-0 rounded-full bg-[var(--surface-raised)] px-1.5 text-[10px] font-medium tabular-nums text-[var(--text-faint)]"
          >
            {count}
          </span>
        )}
      </ProjectLink>
    </li>
  );
}

function SortableProjectItem({
  id,
  slug,
  name,
  count,
  networkId,
  serverId,
}: {
  id: string;
  /** URL form: project slugs are unique per server, so the link can carry one. */
  slug?: string;
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
  const isActiveProject = params.projectId === id || (!!slug && params.projectId === slug);

  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
      <div className="group flex items-stretch gap-0.5 rounded-[10px] hover:bg-[var(--surface-hover)]">
        <ProjectLink
          projectId={slug || id}
          networkId={networkId}
          serverId={serverId}
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
        </ProjectLink>
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
