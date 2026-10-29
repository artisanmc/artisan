import { listDocumentKinds } from "@/domain/documentKinds";
import { type DocKey, commandsOf, dialogsOf, documentsOf, menusOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import type { ProjectId } from "@/domain/types";
import { BoardGroupFrames } from "@/features/canvas/BoardGroupFrames";
import { CommandGroup } from "@/features/canvas/CommandGroup";
import { DialogGroup } from "@/features/canvas/DialogGroup";
import { DocumentGroup } from "@/features/canvas/DocumentGroup";
import { MenuGroup } from "@/features/canvas/MenuGroup";
import type { Edge } from "@/features/canvas/deriveEdges";
import { type Box, routeEdges } from "@/features/canvas/edgeRouting";
import { fitViewport } from "@/features/canvas/focusViewport";
import { type BoardGroup, groupEdges, serverBoard } from "@/features/canvas/groupedBoard";
import { type BoardNode, boardGraph, deriveServerGraph } from "@/features/canvas/serverGraph";
import { usePanZoom } from "@/features/canvas/usePanZoom";
import { useServerProjects } from "@/features/project/useServerProjects";
import { contributionLabel } from "@/lib/moduleDocumentKinds";
import { projectUrlId } from "@/lib/projectUrlId";
import { useCssVar } from "@/lib/themeColors";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Arrow, Stage as KonvaStage, Layer, Rect } from "react-konva";
import { type BoardFilter, filterBoard, parseBoardFilter } from "./boardFilter";

const ROUTE = "/servers/$serverId/canvas" as const;

/** A kind's chip label: the host's for the core kinds, the contribution's for a module's. */
function kindLabel(kind: string, t: TFunction): string {
  const own = `serverCanvas.kinds.${kind}`;
  const label = contributionLabel(
    documentKindContribution(kind),
    kind,
    t,
    useUiStore.getState().editorLang,
  );
  return t(own, { defaultValue: label });
}

export const validateServerCanvasSearch = (search: Record<string, unknown>): BoardFilter =>
  parseBoardFilter(search);

export function ServerCanvasPage() {
  const { t } = useTranslation();
  const { serverId } = useParams({ from: ROUTE });
  const filter = useSearch({ from: ROUTE }) as BoardFilter;
  const navigate = useNavigate();

  const { projects, probes, listing, settled, done, total, failedCount } =
    useServerProjects(serverId);

  const graph = useMemo(() => boardGraph(deriveServerGraph(projects)), [projects]);
  const visible = useMemo(() => filterBoard(graph, filter), [graph, filter]);
  const arrangement = useMemo(
    () => (settled ? serverBoard(projects, visible) : null),
    [settled, visible, projects],
  );

  const setFilter = (next: BoardFilter) =>
    navigate({ to: ROUTE, params: { serverId }, search: next, replace: true });

  const status =
    listing === "loading"
      ? t("serverCanvas.listing")
      : listing === "unavailable"
        ? t("serverCanvas.unavailable")
        : !settled
          ? t("serverCanvas.loading", { done, total })
          : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      {probes}
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <Link to="/servers/$serverId" params={{ serverId }} className="btn btn-ghost btn-sm">
          ← {t("serverCanvas.back")}
        </Link>
        <h1 className="text-[15px] font-semibold text-[var(--text)]">{t("serverCanvas.title")}</h1>
        <span className="text-[12px] text-[var(--text-mut)]">{t("serverCanvas.readOnly")}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`chip${filter.project ? "" : " is-active"}`}
            onClick={() => setFilter({ ...filter, project: undefined })}
          >
            {t("serverCanvas.allProjects")}
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip${filter.project === p.id ? " is-active" : ""}`}
              onClick={() => setFilter({ ...filter, project: p.id })}
            >
              {p.name}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          <button
            type="button"
            className={`chip${filter.kind ? "" : " is-active"}`}
            onClick={() => setFilter({ ...filter, kind: undefined })}
          >
            {t("serverCanvas.allKinds")}
          </button>
          {listDocumentKinds().map(({ kind }) => (
            <button
              key={kind}
              type="button"
              className={`chip${filter.kind === kind ? " is-active" : ""}`}
              onClick={() => setFilter({ ...filter, kind })}
            >
              {kindLabel(kind, t)}
            </button>
          ))}
          <input
            className="input h-8 w-44"
            placeholder={t("serverCanvas.search")}
            value={filter.q ?? ""}
            onChange={(e) => setFilter({ ...filter, q: e.target.value || undefined })}
          />
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
      <div className="relative min-h-0 flex-1">
        {arrangement &&
          (visible.nodes.length === 0 ? (
            <p className="p-6 text-[13px] text-[var(--text-mut)]">
              {graph.nodes.length === 0 ? t("serverCanvas.empty") : t("serverCanvas.noMatch")}
            </p>
          ) : (
            <Board
              storageKey={`server-board:${serverId}`}
              projects={projects}
              nodes={visible.nodes}
              edges={visible.edges.map((e) => ({
                ...e.edge,
                id: e.id,
                // Server keys: `<project>/<kind>/<id>`.
                source: e.source as DocKey,
                target: e.target as DocKey,
              }))}
              positions={arrangement.positions}
              groups={arrangement.groups}
              representatives={arrangement.representatives}
              onOpen={(node) => {
                const project = projects.find((p) => p.id === node.projectId);
                if (!project) return;
                // Opens the project's board, centered on the Document (goToDocument).
                void navigate({
                  to: "/servers/$serverId/projects/$projectId",
                  params: { serverId, projectId: projectUrlId(project) },
                  search: { doc: node.docKey },
                });
              }}
            />
          ))}
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
  groups,
  representatives,
  onOpen,
}: {
  storageKey: string;
  projects: Project[];
  nodes: BoardNode[];
  edges: Edge[];
  positions: Record<string, { x: number; y: number }>;
  groups: BoardGroup[];
  representatives: Record<string, string>;
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
    for (const g of groups) {
      width = Math.max(width, g.x + g.width);
      height = Math.max(height, g.y + g.height);
    }
    return { width: width + 40, height: height + 40 };
  }, [nodes, positions, groups]);

  useEffect(() => {
    if (fitted.current || size.w === 0) return;
    fitted.current = true;
    setViewport(fitViewport(size, bounds));
  }, [size, bounds, setViewport]);

  const boxes = useMemo(() => {
    const out: Record<string, Box> = {};
    for (const n of nodes) {
      const p = positions[n.key];
      if (p) out[n.key] = { ...p, width: n.width, height: n.height };
    }
    return out;
  }, [nodes, positions]);
  const routed = useMemo(
    () => routeEdges({ edges: groupEdges(edges, representatives), boxes }),
    [edges, boxes, representatives],
  );

  const byProject = useMemo(() => new Map(projects.map((p) => [p.id as string, p])), [projects]);
  const layouts = useMemo(() => {
    const out = new Map<string, Record<string, { x: number; y: number }>>();
    for (const n of nodes) {
      const p = positions[n.key];
      if (!p) continue;
      const layout = out.get(n.projectId) ?? {};
      layout[n.docKey] = p;
      out.set(n.projectId, layout);
    }
    return out;
  }, [nodes, positions]);

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
        onDragEnd={(e) => {
          const stage = stageRef.current;
          if (!stage || e.target !== stage) return;
          setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
        }}
      >
        <Layer>
          <BoardGroupFrames groups={groups} />
        </Layer>
        <Layer listening={false}>
          {routed.map((r) => (
            <Arrow
              key={r.edge.id}
              points={r.points}
              bezier
              stroke={
                hovered && (r.edge.source === hovered || r.edge.target === hovered)
                  ? brand
                  : edgeColor
              }
              fill={
                hovered && (r.edge.source === hovered || r.edge.target === hovered)
                  ? brand
                  : edgeColor
              }
              strokeWidth={1.5}
              pointerLength={9}
              pointerWidth={8}
            />
          ))}
        </Layer>
        {/* Same rendering as the project views, but with no gesture: a layer
            that listens to nothing can neither move a menu nor edit a slot. */}
        <Layer listening={false} imageSmoothingEnabled={false}>
          {nodes.map((n) => {
            const project = byProject.get(n.projectId);
            const position = positions[n.key];
            if (!project || !position) return null;
            if (n.kind === "menu") {
              const menu = menusOf(project).find((m) => m.id === n.docId);
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
              const command = commandsOf(project).find((c) => c.id === n.docId);
              return command ? (
                <CommandGroup
                  key={n.key}
                  projectId={project.id}
                  command={command}
                  position={position}
                />
              ) : null;
            }
            if (n.kind === "dialog") {
              const dialog = dialogsOf(project).find((d) => d.id === n.docId);
              return dialog ? (
                <DialogGroup
                  key={n.key}
                  projectId={project.id}
                  dialog={dialog}
                  position={position}
                />
              ) : null;
            }
            const doc = documentsOf(project, n.kind).find((d) => d.id === n.docId);
            return doc ? (
              <DocumentGroup
                key={n.key}
                project={project}
                kind={n.kind}
                doc={doc}
                position={position}
              />
            ) : null;
          })}
        </Layer>
        <Layer>
          {nodes.map((n) => {
            const p = positions[n.key];
            if (!p) return null;
            const isHovered = hovered === n.key;
            return (
              <Rect
                key={n.key}
                x={p.x}
                y={p.y}
                width={n.width}
                height={n.height}
                fill="transparent"
                stroke={isHovered ? brand : undefined}
                strokeWidth={isHovered ? 2 : 0}
                onMouseEnter={() => setHovered(n.key)}
                onMouseLeave={() => setHovered((h) => (h === n.key ? null : h))}
                onClick={() => onOpen(n)}
                onTap={() => onOpen(n)}
              />
            );
          })}
        </Layer>
      </KonvaStage>
    </div>
  );
}
