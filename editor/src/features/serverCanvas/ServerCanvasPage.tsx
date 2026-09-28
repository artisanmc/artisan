import { ownerModuleOf } from "@/components/projectOwnership";
import type { Project } from "@/domain/types";
import type { ProjectId } from "@/domain/types";
import { CommandGroup } from "@/features/canvas/CommandGroup";
import { DialogGroup } from "@/features/canvas/DialogGroup";
import { MenuGroup } from "@/features/canvas/MenuGroup";
import { GUTTER_LABEL_HEIGHT, arrangeBoard } from "@/features/canvas/arrangeBoard";
import type { Edge } from "@/features/canvas/deriveEdges";
import { type Box, routeEdges } from "@/features/canvas/edgeRouting";
import { fitViewport } from "@/features/canvas/focusViewport";
import {
  type BoardNode,
  type DocumentKind,
  deriveServerGraph,
} from "@/features/canvas/serverGraph";
import { type ViewportState, usePanZoom } from "@/features/canvas/usePanZoom";
import { documentLabel } from "@/features/project/useProjectDocuments";
import { useProjectLoader } from "@/features/project/useProjectLoader";
import { buildProjectGroups, diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { type ProjectSummary, getNetwork } from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import { projectUrlId } from "@/lib/projectUrlId";
import { useCssVar } from "@/lib/themeColors";
import { useModulesStore } from "@/state/modulesStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useUiStore } from "@/state/uiStore";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type Konva from "konva";
import { PanelLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Arrow, Stage as KonvaStage, Layer, Rect, Text } from "react-konva";
import { ServerRegistry } from "./ServerRegistry";
import { type BoardFilter, filterBoard, parseBoardFilter } from "./boardFilter";
import { revealViewport, tweenViewport } from "./camera";
import { buildRegistry, selectDocument, toggleGroup } from "./registryTree";

const ROUTE = "/networks/$networkId/servers/$serverId/canvas" as const;
const KINDS: DocumentKind[] = ["menu", "command", "dialog"];
const REVEAL_MS = 250;

export const validateServerCanvasSearch = (search: Record<string, unknown>): BoardFilter =>
  parseBoardFilter(search);

interface ProbeResult {
  project: Project | null;
  failed: boolean;
}

/** Charge un project exactement comme sa propre vue (disque + brouillon), pour que la planche montre la même chose. */
function ProjectProbe({
  loadRef,
  serverId,
  networkId,
  onResult,
}: {
  loadRef: string;
  serverId: string;
  networkId: string;
  onResult: (loadRef: string, result: ProbeResult) => void;
}) {
  const { project, error, offline } = useProjectLoader(loadRef, serverId, networkId);
  const failed = error != null || offline;
  useEffect(() => onResult(loadRef, { project, failed }), [loadRef, project, failed, onResult]);
  return null;
}

export function ServerCanvasPage() {
  const { t } = useTranslation();
  const { networkId, serverId } = useParams({ from: ROUTE });
  const filter = useSearch({ from: ROUTE }) as BoardFilter;
  const navigate = useNavigate();

  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [listing, setListing] = useState<"loading" | "ready" | "unavailable">("loading");
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [serverKeyId, setServerKeyId] = useState<string | null>(null);
  const [registryOpen, setRegistryOpen] = useState(true);
  // Incrémenté quand la sélection vient d'ailleurs que la planche (registre,
  // lien partagé) : c'est le signal pour que la caméra aille la montrer. Un
  // clic sur la planche ne l'incrémente pas — ce qu'on clique est déjà visible.
  const [reveal, setReveal] = useState(filter.doc ? 1 : 0);
  const activeLang = useUiStore((s) => s.activeLang);
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
  const serverScreens = useServerScreensStore((s) => s.screens);

  useEffect(() => {
    let cancelled = false;
    setListing("loading");
    getNetwork(networkId)
      .then(async (network) => {
        const key = network.serverKeys.find((k) => k.slug === serverId || k.id === serverId);
        if (!key) throw new Error("unknown_server");
        if (!cancelled) setServerKeyId(key.id);
        const res = await listServerProjects(networkId, key.id);
        if (cancelled) return;
        if (!res.ok) {
          setListing("unavailable");
          return;
        }
        setSummaries(diskProjectsToSummaries(networkId, key.id, res.projectIds, res.projects));
        setListing("ready");
      })
      .catch(() => {
        if (!cancelled) setListing("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [networkId, serverId]);

  // Les Config screens décident du regroupement par module, comme sur la page
  // du serveur. L'appel est idempotent.
  useEffect(() => {
    if (serverKeyId) useServerScreensStore.getState().load({ networkId, serverId: serverKeyId });
  }, [networkId, serverKeyId]);

  const onResult = useCallback((loadRef: string, result: ProbeResult) => {
    setResults((prev) => {
      const current = prev[loadRef];
      if (current && current.project === result.project && current.failed === result.failed)
        return prev;
      return { ...prev, [loadRef]: result };
    });
  }, []);

  const refs = useMemo(() => (summaries ?? []).map((s) => projectUrlId(s)), [summaries]);
  const done = refs.filter((ref) => results[ref]?.project || results[ref]?.failed).length;
  const failedCount = refs.filter((ref) => results[ref]?.failed && !results[ref]?.project).length;
  const settled = listing === "ready" && done === refs.length;

  const projects = useMemo(
    () => refs.map((ref) => results[ref]?.project).filter((p): p is Project => p != null),
    [refs, results],
  );

  const graph = useMemo(() => deriveServerGraph(projects), [projects]);
  const byProjectId = useMemo(() => new Map(projects.map((p) => [p.id as string, p])), [projects]);
  const labelOf = useCallback(
    (n: BoardNode) => {
      const p = byProjectId.get(n.projectId);
      return p ? documentLabel(p, n.docId, activeLang) : undefined;
    },
    [byProjectId, activeLang],
  );
  // La sélection ne change pas ce qui est affiché : seuls les filtres entrent
  // dans le calcul, pour que sélectionner ne relance pas l'arrangement.
  const { hide, kind, q } = filter;
  const hideKey = (hide ?? []).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: hideKey résume `hide`
  const visible = useMemo(
    () => filterBoard(graph, { hide, kind, q }, labelOf),
    [graph, hideKey, kind, q, labelOf],
  );
  const arrangement = useMemo(
    () => (settled ? arrangeBoard({ nodes: visible.nodes, edges: visible.edges }) : null),
    [settled, visible],
  );

  // Le même découpage projects ordinaires / modules que la sidebar et la page
  // du serveur, appliqué aux projects effectivement chargés.
  const registry = useMemo(() => {
    const { moduleGroups } = buildProjectGroups({
      projects: summaries ?? [],
      screens: serverScreens,
      mountedModuleIds,
      localProjects: projects,
    });
    const entries = (summaries ?? []).flatMap((s) => {
      const project = results[projectUrlId(s)]?.project;
      return project ? [{ project, ownerModule: ownerModuleOf(s, serverScreens) ?? null }] : [];
    });
    return buildRegistry({
      entries,
      modules: moduleGroups.map((g) => ({ id: g.id, label: g.label, screens: g.screens })),
      edges: visible.edges,
      filter,
      activeLang,
    });
  }, [summaries, results, serverScreens, mountedModuleIds, projects, visible, filter, activeLang]);

  const setFilter = (next: BoardFilter) =>
    navigate({ to: ROUTE, params: { networkId, serverId }, search: next, replace: true });

  const openFocus = (node: BoardNode) => {
    const project = byProjectId.get(node.projectId);
    if (!project) return;
    void navigate({
      to: "/networks/$networkId/servers/$serverId/projects/$projectId/document/$documentId",
      params: { networkId, serverId, projectId: projectUrlId(project), documentId: node.docId },
    });
  };
  const selectedNode = visible.nodes.find((n) => n.key === filter.doc);

  const status =
    listing === "loading"
      ? t("serverCanvas.listing")
      : listing === "unavailable"
        ? t("serverCanvas.unavailable")
        : !settled
          ? t("serverCanvas.loading", { done, total: refs.length })
          : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      {summaries?.map((s) => (
        <ProjectProbe
          key={projectUrlId(s)}
          loadRef={projectUrlId(s)}
          serverId={serverId}
          networkId={networkId}
          onResult={onResult}
        />
      ))}
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-pressed={registryOpen}
          aria-label={t("serverCanvas.registry.toggle")}
          title={t("serverCanvas.registry.toggle")}
          onClick={() => setRegistryOpen((o) => !o)}
        >
          <PanelLeft className="size-4" />
        </button>
        <Link
          to="/networks/$networkId/servers/$serverId"
          params={{ networkId, serverId }}
          className="btn-ghost btn-sm"
        >
          ← {t("serverCanvas.back")}
        </Link>
        <h1 className="text-[15px] font-semibold text-[var(--text)]">{t("serverCanvas.title")}</h1>
        <span className="text-[12px] text-[var(--text-mut)]">{t("serverCanvas.readOnly")}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`chip${filter.kind ? "" : " is-active"}`}
            onClick={() => setFilter({ ...filter, kind: undefined })}
          >
            {t("serverCanvas.allKinds")}
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${filter.kind === k ? " is-active" : ""}`}
              onClick={() => setFilter({ ...filter, kind: k })}
            >
              {t(`serverCanvas.kinds.${k}`)}
            </button>
          ))}
        </div>
      </header>
      <div className="flex items-center gap-3 px-4 py-1.5 text-[12px] text-[var(--text-mut)]">
        {status ??
          t("serverCanvas.stats", { documents: visible.nodes.length, links: visible.edges.length })}
        {settled && graph.unresolved.length > 0 && (
          <span className="badge badge-amber" title={t("serverCanvas.unresolvedHint")}>
            {t("serverCanvas.unresolved", { count: graph.unresolved.length })}
          </span>
        )}
        {failedCount > 0 && (
          <span className="badge badge-brick">
            {t("serverCanvas.failed", { count: failedCount })}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {registryOpen && (
          <aside className="h-full w-[260px] max-w-[70vw] shrink-0">
            <ServerRegistry
              networkId={networkId}
              serverId={serverId}
              groups={registry.groups}
              unlinked={registry.unlinked}
              selected={filter.doc}
              query={filter.q ?? ""}
              onQueryChange={(value) => setFilter({ ...filter, q: value || undefined })}
              onToggleGroup={(group) => setFilter(toggleGroup(filter, group))}
              onSelect={(item) => {
                setFilter(selectDocument(filter, item));
                setReveal((n) => n + 1);
              }}
            />
          </aside>
        )}
        <div className="relative min-h-0 min-w-0 flex-1">
          {arrangement &&
            (visible.nodes.length === 0 ? (
              <p className="p-6 text-[13px] text-[var(--text-mut)]">
                {graph.nodes.length === 0 ? t("serverCanvas.empty") : t("serverCanvas.noMatch")}
              </p>
            ) : (
              <Board
                storageKey={`server-board:${networkId}/${serverId}`}
                projects={projects}
                nodes={visible.nodes}
                edges={visible.edges.map((e) => ({
                  ...e.edge,
                  id: e.id,
                  source: e.source,
                  target: e.target,
                }))}
                positions={arrangement.positions}
                gutter={arrangement.gutter}
                gutterLabel={t("serverCanvas.gutter")}
                selected={filter.doc}
                reveal={reveal}
                onSelect={(node) => setFilter({ ...filter, doc: node?.key })}
                onOpen={openFocus}
              />
            ))}
          {selectedNode && (
            <div
              data-testid="server-board-selection"
              className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-raised)] py-1 pr-1 pl-3 shadow-[var(--shadow-lg)]"
            >
              <span className="truncate text-[13px] font-medium text-[var(--text)]">
                {labelOf(selectedNode) ?? selectedNode.docId}
              </span>
              {projects.length > 1 && (
                <span className="badge shrink-0">
                  {byProjectId.get(selectedNode.projectId)?.name}
                </span>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm shrink-0"
                onClick={() => openFocus(selectedNode)}
              >
                {t("serverCanvas.edit")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Board({
  storageKey,
  projects,
  nodes,
  edges,
  positions,
  gutter,
  gutterLabel,
  selected,
  reveal,
  onSelect,
  onOpen,
}: {
  storageKey: string;
  projects: Project[];
  nodes: BoardNode[];
  edges: Edge[];
  positions: Record<string, { x: number; y: number }>;
  gutter: { x: number; y: number } | null;
  gutterLabel: string;
  selected: string | undefined;
  /** Change quand la sélection doit être amenée à l'écran (cf. `revealViewport`). */
  reveal: number;
  onSelect: (node: BoardNode | null) => void;
  onOpen: (node: BoardNode) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const saved = useUiStore.getState().canvasViewports[storageKey];
  const { viewport, setViewport, onWheel } = usePanZoom(saved);
  const fitted = useRef(saved != null);
  const [hovered, setHovered] = useState<string | null>(null);
  const edgeColor = useCssVar("--border-strong");
  const brand = useCssVar("--brand");
  const muted = useCssVar("--text-mut");

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    useUiStore.getState().setCanvasViewport(storageKey as ProjectId, viewport);
  }, [storageKey, viewport]);

  const bounds = useMemo(() => {
    let width = 0;
    let height = 0;
    for (const n of nodes) {
      const p = positions[n.key];
      if (!p) continue;
      width = Math.max(width, p.x + n.width);
      height = Math.max(height, p.y + n.height);
    }
    return { width: width + 40, height: height + 40 };
  }, [nodes, positions]);

  const handledReveal = useRef(0);
  // Une sélection absente de la planche (filtrée, supprimée) n'a rien à montrer :
  // elle ne doit pas empêcher le cadrage d'ensemble.
  const revealPending =
    reveal !== handledReveal.current && selected != null && positions[selected] != null;
  useEffect(() => {
    // Un lien partagé avec `?doc=` s'ouvre sur ce Document, pas sur tout le serveur.
    if (fitted.current || size.w === 0 || revealPending) return;
    fitted.current = true;
    setViewport(fitViewport(size, bounds));
  }, [size, bounds, setViewport, revealPending]);

  const boxes = useMemo(() => {
    const out: Record<string, Box> = {};
    for (const n of nodes) {
      const p = positions[n.key];
      if (p) out[n.key] = { ...p, width: n.width, height: n.height };
    }
    return out;
  }, [nodes, positions]);
  const routed = useMemo(() => routeEdges({ edges, boxes }), [edges, boxes]);

  // Amener la sélection à l'écran quand on le demande — et seulement si elle
  // n'y est pas déjà (cf. `revealViewport`). Le viewport courant est lu via une
  // ref : l'effet ne doit pas se relancer à chaque pan.
  const viewportRef = useRef<ViewportState>(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    if (reveal === handledReveal.current || !selected || size.w === 0) return;
    const box = boxes[selected];
    if (!box) return;
    handledReveal.current = reveal;
    const first = !fitted.current;
    fitted.current = true;
    const from = viewportRef.current;
    // Premier cadrage (lien partagé) : on pose la caméra sans animation, à
    // l'échelle 1 au plus — il n'y a pas de position d'origine à préserver.
    const to = revealViewport(size, box, first ? { x: -1e9, y: -1e9, scale: 1 } : from);
    if (!to) return;
    if (first || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setViewport(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = (now - start) / REVEAL_MS;
      setViewport(tweenViewport(from, to, t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reveal, selected, boxes, size, setViewport]);

  const byProject = useMemo(() => new Map(projects.map((p) => [p.id as string, p])), [projects]);
  const layouts = useMemo(() => {
    const out = new Map<string, Record<string, { x: number; y: number }>>();
    for (const n of nodes) {
      const p = positions[n.key];
      if (!p) continue;
      const layout = out.get(n.projectId) ?? {};
      layout[n.docId] = p;
      out.set(n.projectId, layout);
    }
    return out;
  }, [nodes, positions]);
  const showProvenance = projects.length > 1;
  const lit = (key: string) => key === hovered || key === selected;

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0"
      style={{ cursor: hovered ? "pointer" : "grab" }}
    >
      <KonvaStage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable
        dragDistance={4}
        onWheel={onWheel}
        onClick={(e) => {
          // Un clic dans le vide désélectionne ; un clic sur un nœud est traité
          // par son rectangle.
          if (e.target === stageRef.current) onSelect(null);
        }}
        onDragEnd={(e) => {
          const stage = stageRef.current;
          if (!stage || e.target !== stage) return;
          setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
        }}
      >
        <Layer listening={false}>
          {routed.map((r) => (
            <Arrow
              key={r.edge.id}
              points={r.points}
              bezier
              stroke={lit(r.edge.source) || lit(r.edge.target) ? brand : edgeColor}
              fill={lit(r.edge.source) || lit(r.edge.target) ? brand : edgeColor}
              strokeWidth={1.5}
              pointerLength={9}
              pointerWidth={8}
            />
          ))}
          {gutter && (
            <Text
              x={gutter.x}
              y={gutter.y}
              text={gutterLabel}
              fontSize={14}
              fill={muted}
              height={GUTTER_LABEL_HEIGHT}
            />
          )}
        </Layer>
        {/* Rendu identique aux vues project, mais sans aucun geste : un calque
            qui n'écoute rien ne peut ni déplacer un menu ni en modifier un slot. */}
        <Layer listening={false} imageSmoothingEnabled={false}>
          {nodes.map((n) => {
            const project = byProject.get(n.projectId);
            const position = positions[n.key];
            if (!project || !position) return null;
            if (n.kind === "menu") {
              const menu = project.menus.find((m) => m.id === n.docId);
              return menu ? (
                <MenuGroup
                  key={n.key}
                  projectId={project.id}
                  menu={menu}
                  position={position}
                  layout={layouts.get(n.projectId) ?? {}}
                />
              ) : null;
            }
            if (n.kind === "command") {
              const command = project.commands.find((c) => c.id === n.docId);
              return command ? (
                <CommandGroup
                  key={n.key}
                  projectId={project.id}
                  command={command}
                  position={position}
                />
              ) : null;
            }
            const dialog = (project.dialogs ?? []).find((d) => d.id === n.docId);
            return dialog ? (
              <DialogGroup key={n.key} projectId={project.id} dialog={dialog} position={position} />
            ) : null;
          })}
        </Layer>
        <Layer>
          {nodes.map((n) => {
            const p = positions[n.key];
            if (!p) return null;
            const isSelected = selected === n.key;
            const isHovered = hovered === n.key;
            return (
              <Rect
                key={n.key}
                x={p.x}
                y={p.y}
                width={n.width}
                height={n.height}
                fill="transparent"
                stroke={isSelected || isHovered ? brand : undefined}
                strokeWidth={isSelected ? 3 : isHovered ? 2 : 0}
                onMouseEnter={() => setHovered(n.key)}
                onMouseLeave={() => setHovered((h) => (h === n.key ? null : h))}
                onClick={() => onSelect(n)}
                onTap={() => onSelect(n)}
                onDblClick={() => onOpen(n)}
                onDblTap={() => onOpen(n)}
              />
            );
          })}
          {showProvenance &&
            nodes.map((n) => {
              const p = positions[n.key];
              const project = byProject.get(n.projectId);
              if (!p || !project) return null;
              return (
                <Text
                  key={`${n.key}:provenance`}
                  x={p.x}
                  y={p.y - 16}
                  text={project.name}
                  fontSize={11}
                  fill={muted}
                  listening={false}
                />
              );
            })}
        </Layer>
      </KonvaStage>
    </div>
  );
}
