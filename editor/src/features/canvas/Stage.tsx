import { EmptyState } from "@/components/ui/empty-state";
import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useHoverStore } from "@/state/hoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Only the primary (left) button drags Konva nodes / the stage. This frees the
// middle button for panning (handled manually via useMiddleClickPan) without it
// accidentally starting a node drag when pressed over a menu.
Konva.dragButtons = [0];
import { useTranslation } from "react-i18next";
import { Stage as KonvaStage, Layer } from "react-konva";
import { toast } from "sonner";
import { AlignmentGuides } from "./AlignmentGuidesOverlay";
import { ArmedBanner } from "./ArmedBanner";
import { CanvasToolbar } from "./CanvasToolbar";
import { CommandGroup } from "./CommandGroup";
import { ContextMenu } from "./ContextMenu";
import { DialogGroup } from "./DialogGroup";
import { EdgeTooltip } from "./EdgeTooltip";
import { Edges } from "./Edges";
import { GhostChips } from "./GhostChips";
import { ItemTooltip } from "./ItemTooltip";
import { MarqueeRect } from "./MarqueeRect";
import { MenuGroup } from "./MenuGroup";
import { NewCommandDialog } from "./NewCommandDialog";
import { NewDialogDialog } from "./NewDialogDialog";
import { NewMenuDialog } from "./NewMenuDialog";
import { Selection } from "./Selection";
import { autoLayout } from "./autoLayout";
import { openProjectSettings } from "@/features/project/projectSettings";
import { dispatchOpenElement } from "./canvasEvents";
import { fitViewport } from "./focusViewport";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { menuBoxSize } from "./menuLayout";
import { setStageDropTarget, setStageSlotHitTest } from "./stageDropTarget";
import { setStageGeometryProvider } from "./stageGeometry";
import { canvasClipboardActions, useCanvasKeyboard } from "./useCanvasKeyboard";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { useMiddleClickPan } from "./useMiddleClickPan";
import { usePanZoom } from "./usePanZoom";
import { useStageContextMenu } from "./useStageContextMenu";
import { useStageTouch } from "./useStageTouch";

interface StageProps {
  projectId: ProjectId;
  /**
   * Vue focus : le stage ne montre que ce Document, quelle que soit son
   * appartenance à la planche. Tout le reste de la chrome (arêtes, pastilles,
   * sélection, dépôt d'items, clavier) est celle de la planche — c'est le point
   * de la fusion : une seule implémentation, deux cadrages.
   */
  focus?: ElementId;
}

export function Stage({ projectId, focus }: StageProps) {
  const focusMode = focus != null;
  const { t } = useTranslation();
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Restore the saved pan/zoom for this project so leaving the board (single
  // element view) and returning lands on the same spot + zoom. Read once at
  // mount (non-reactive); persisted back via the effect below.
  // Le focus a son propre cadrage, partagé par tous les Documents (passer de
  // l'un à l'autre garde la vue là où l'utilisateur l'a mise) et persisté ;
  // la planche garde le sien, par project et session-only.
  const savedFocusViewport = useUiStore.getState().documentViewport;
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom(
    focusMode
      ? (savedFocusViewport ?? { x: 0, y: 0, scale: 1 })
      : useUiStore.getState().canvasViewports[projectId],
  );
  // En focus, la vue est cadrée à l'ouverture puis ne se bat plus avec
  // l'utilisateur : dès qu'il a navigué, elle reste où il l'a mise.
  const touchedRef = useRef(!focusMode || savedFocusViewport !== null);
  const markTouched = useCallback(() => {
    touchedRef.current = true;
  }, []);
  const canvasMode = useUiStore((s) => s.canvasMode);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Alt held = temporary pan (like Space), so you can navigate without leaving
  // select mode. Alt during a *node* drag still means "free move / no snap"
  // (useNodeAlignment) — different target, no conflict.
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      const tag = n?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || !!n?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" && !isEditable(e.target)) { e.preventDefault(); setSpaceHeld(true); }
      if (e.key === "Alt" && !isEditable(e.target)) { e.preventDefault(); setAltHeld(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => { setSpaceHeld(false); setAltHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const panMode = canvasMode === "hand" || spaceHeld || altHeld;
  // True while a stage-drag pan is in progress (hand/Space/Alt left-drag) — so
  // the cursor can switch from open hand (grab) to closed hand (grabbing).
  const [stageDragging, setStageDragging] = useState(false);
  // Pan cursor only over EMPTY canvas: entities (menus/slots/commands…) keep
  // their own affordances — the grab hand over an item read as incoherent.
  const [overEmpty, setOverEmpty] = useState(true);

  // Konva's native stage-drag (single-finger pan) mutates the stage's x/y
  // directly without going through React. Without this sync, the next
  // re-render snaps the canvas back to the stale `viewport` prop, which
  // also drifts every DOM overlay (TextEditor, ArmedBanner) and every
  // pointer-to-world conversion (tap-to-place).
  const syncViewportFromStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    markTouched();
    setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  }, [setViewport, markTouched]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Persist pan/zoom per project so it survives leaving/returning to the board.
  useEffect(() => {
    if (focusMode) {
      if (touchedRef.current) useUiStore.getState().setDocumentViewport(viewport);
      return;
    }
    useUiStore.getState().setCanvasViewport(projectId, viewport);
  }, [projectId, viewport, focusMode]);

  /**
   * Toute la différence planche / focus tient ici. La planche lit
   * l'appartenance réelle (`canvasLayout` via `autoLayout`) ; le focus
   * fabrique une planche synthétique d'un seul Document posé à l'origine.
   * Tout ce qui suit — arêtes, pastilles hors-planche, marquee, hit-test,
   * dépôt — consomme cette table et suit sans le savoir.
   */
  const layout = useMemo(
    () => (focus ? { [focus]: { x: 0, y: 0 } } : project ? autoLayout(project) : {}),
    [project, focus],
  );

  // Cadrage initial du Document focalisé : centré, réduit seulement s'il ne
  // tient pas — jamais agrandi.
  const focusBox = useMemo(() => {
    if (!focus) return null;
    // `focus` est un id de Document (l'ombrelle) ; `menu.id` est un MenuId.
    // Les marques nominales ne se recouvrent pas, la comparaison est textuelle.
    const menu = project?.menus.find((m) => (m.id as string) === (focus as string));
    return menu ? menuBoxSize(menu.inventoryType ?? "chest", menu.rows) : null;
  }, [project, focus]);
  useEffect(() => {
    if (touchedRef.current || size.w === 0 || !focusBox) return;
    setViewport(fitViewport(size, focusBox));
  }, [size, focusBox, setViewport]);

  const marquee = useMarqueeSelection({
    stageRef,
    viewport,
    project,
    layout,
    active: canvasMode === "select" && !spaceHeld && !altHeld,
  });

  // Middle-button pans regardless of mode/target (document capture listener).
  const middlePan = useMiddleClickPan({ containerRef: wrapperRef, viewport, setViewport });

  // Empty-stage click clears selection. Konva fires `click` on the Stage when
  // the user clicks an area not occupied by any listening child.
  // Also: if a material is "armed" from the Library (touch placement flow),
  // a click on a slot places it. Hit-test in world coords.
  // suppressClick: if a marquee drag just completed, the follow-up stage click
  // must not clear the selection the marquee just made.
  const onStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const armed = useUiStore.getState().armedMaterial;
      if (armed && project) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer) {
          const world = screenToWorld(pointer, viewport);
          const hit = hitTestSlot(project, layout, world.x, world.y);
          if (hit) {
            try {
              useAccountStore.getState().setSlotMaterial({
                projectId,
                menuId: hit.menuId as MenuId,
                position: hit.position,
                material: armed,
              });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "place failed");
            }
            return;
          }
        }
      }
      // Click (not drag) on empty space clears the selection — in every mode,
      // including hand/space/alt pan (a real pan fires dragend, not click, so it
      // won't clear). suppressed = a marquee drag just finished.
      const suppressed = marquee.shouldConsumeClick();
      if (!suppressed && e.target === e.target.getStage()) {
        useSelectionStore.getState().clear();
        useEdgeSelectionStore.getState().select(null);
        useUiStore.getState().setSelectedLayerKey(null);
      }
    },
    [project, layout, viewport, projectId, marquee.shouldConsumeClick],
  );

  const [pendingMenuPos, setPendingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingCommandPos, setPendingCommandPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingDialogPos, setPendingDialogPos] = useState<{ x: number; y: number } | null>(null);

  const { ctxMenu, openContextMenuAt, onStageContextMenu, closeCtxMenu } = useStageContextMenu({
    project,
    layout,
    viewport,
    wrapperRef,
    stageRef,
  });

  const {
    onTouchStart: onStageTouchStart,
    onTouchMoveLocal: onStageTouchMove,
    onTouchEndLocal: onStageTouchEnd,
  } = useStageTouch({
    openContextMenuAt,
    onTouchMove,
    onTouchEnd,
  });

  // Cross-platform Library drop: the top-level DndContext (in the project
  // route) calls this with the release coords + material. We hit-test the
  // slot and place. Returns true if placed, so the route can decide
  // whether to do anything else.
  useEffect(() => {
    setStageDropTarget((clientX, clientY, material) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !project) return false;
      const rect = wrapper.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return false;
      }
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);
      const hit = hitTestSlot(project, layout, world.x, world.y);
      if (!hit) return false;
      try {
        useAccountStore.getState().setSlotMaterial({
          projectId,
          menuId: hit.menuId as MenuId,
          position: hit.position,
          material,
        });
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "place failed");
        return false;
      }
    });
    return () => setStageDropTarget(null);
  }, [project, layout, viewport, projectId]);

  // Placement-mode row drops: resolve release coords to a menu/slot (the route's
  // onDragEnd pins the row). Same wrapper-rect → world → hit-test as above.
  useEffect(() => {
    setStageSlotHitTest((clientX, clientY) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !project) return null;
      const rect = wrapper.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);
      return hitTestSlot(project, layout, world.x, world.y);
    });
    return () => setStageSlotHitTest(null);
  }, [project, layout, viewport]);

  // Expose the live wrapper rect + viewport so the 3rd-column LayersPanel can
  // convert drag-end client coords into canvas coords (cursor-based new-layer
  // attach in P1.11). The provider reads refs at call time, so consumers
  // always see the current pan/scale + bounding box.
  useEffect(() => {
    setStageGeometryProvider(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;
      const rect = wrapper.getBoundingClientRect();
      return {
        wrapperRect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        viewport,
      };
    });
    return () => setStageGeometryProvider(null);
  }, [viewport]);

  useCanvasKeyboard({
    projectId,
    onError: (msg) => toast.error(msg),
  });

  const onWrapperMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    useHoverStore.getState().setCursor(e.clientX, e.clientY);
  }, []);

  const onWrapperMouseLeave = useCallback(() => {
    // Clear hover when the cursor leaves the canvas entirely (Konva
    // mouseleave on a slot doesn't fire if we exit the whole stage at speed).
    useHoverStore.getState().setElement(null);
  }, []);

  if (!project) return <div className="p-8 text-[var(--text-mut)]">Project not found.</div>;

  const entityIds = ctxMenu.target.kind === "entity" ? ctxMenu.target.selectedIds : [];

  return (
    <div
      ref={wrapperRef}
      className="stage-bg-dots relative h-full w-full"
      style={{
        cursor:
          middlePan.panning || stageDragging
            ? "grabbing"
            : panMode && overEmpty
              ? "grab"
              : "default",
      }}
      onMouseMove={onWrapperMouseMove}
      onMouseLeave={() => {
        setOverEmpty(true);
        onWrapperMouseLeave();
      }}
    >
      <div aria-hidden className="stage-bg-glow pointer-events-none absolute inset-0" />
      {!focusMode && Object.keys(layout).length === 0 && (
        // pointer-events-none lets right-click / drag fall through to the Konva
        // stage below (so the create context-menu still works); only the action
        // buttons opt back into pointer events.
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <EmptyState
            title={t("projectPanel.empty")}
            action={
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setPendingMenuPos({ x: 40, y: 40 })}
                >
                  {t("canvas.newMenu")}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setPendingCommandPos({ x: 40, y: 40 })}
                >
                  {t("canvas.newCommand")}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setPendingDialogPos({ x: 40, y: 40 })}
                >
                  {t("canvas.newDialog")}
                </button>
                {project.menus.length + project.commands.length + project.dialogs.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => useAccountStore.getState().arrangeAllOnBoard({ projectId })}
                  >
                    {t("projectPanel.arrangeAll")}
                  </button>
                )}
              </div>
            }
          />
        </div>
      )}
      <ArmedBanner />
      <CanvasToolbar />
      <KonvaStage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={panMode}
        onWheel={(e) => {
          markTouched();
          onWheel(e);
        }}
        onClick={onStageClick}
        onDblClick={(e) => {
          // Échappatoire du focus : un double-clic sur le fond recadre.
          if (!focusBox || e.target !== e.target.getStage()) return;
          const fitted = fitViewport(size, focusBox);
          touchedRef.current = false;
          setViewport(fitted);
          useUiStore.getState().setDocumentViewport(fitted);
          touchedRef.current = true;
        }}
        onTap={onStageClick}
        onMouseDown={marquee.onMouseDown}
        onMouseMove={(e) => {
          setOverEmpty(e.target === e.target.getStage());
          marquee.onMouseMove();
        }}
        onMouseUp={marquee.onMouseUp}
        onContextMenu={onStageContextMenu}
        onTouchStart={onStageTouchStart}
        onTouchMove={(e) => {
          markTouched();
          onStageTouchMove(e);
        }}
        onTouchEnd={onStageTouchEnd}
        onDragStart={(e) => {
          if (e.target === e.target.getStage()) setStageDragging(true);
        }}
        onDragMove={(e) => {
          // Only sync when the drag target is the Stage itself (not a
          // child Group like a menu or a slot, which fire dragmove too).
          if (e.target === e.target.getStage()) syncViewportFromStage();
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            syncViewportFromStage();
            setStageDragging(false);
          }
        }}
      >
        <Layer name="edges">
          <Edges project={project} layout={layout} />
        </Layer>
        <Layer name="menus" imageSmoothingEnabled={false}>
          {project.menus.filter((menu) => layout[menu.id]).map((menu) => (
            <MenuGroup
              key={menu.id}
              projectId={projectId}
              menu={menu}
              position={layout[menu.id]!}
              layout={layout}
              solo={focusMode}
            />
          ))}
        </Layer>
        {/* Commands and dialogs render above the menus layer so they always
            take click priority, even after a menu calls moveToTop() during drag. */}
        <Layer name="commands" imageSmoothingEnabled={false}>
          {project.commands.filter((command) => layout[command.id]).map((command) => (
            <CommandGroup
              key={command.id}
              projectId={projectId}
              command={command}
              position={layout[command.id]!}
            />
          ))}
          {project.dialogs.filter((dialog) => layout[dialog.id]).map((dialog) => (
            <DialogGroup
              key={dialog.id}
              projectId={projectId}
              dialog={dialog}
              position={layout[dialog.id]!}
            />
          ))}
          <GhostChips
            project={project}
            layout={layout}
            projectId={projectId}
            // En focus, tous les liens du Document sont hors-planche : la
            // pastille devient le moyen de circuler de Document en Document,
            // au lieu de peupler une planche qu'on ne regarde pas.
            onOpen={focusMode ? dispatchOpenElement : undefined}
          />
        </Layer>
        <Layer name="overlay">
          <Selection stageRef={stageRef} />
          <MarqueeRect rect={marquee.rect} />
          <AlignmentGuides />
        </Layer>
      </KonvaStage>
      <ItemTooltip projectId={projectId} />
      <EdgeTooltip project={project} />
      <ContextMenu
        projectId={projectId}
        state={ctxMenu}
        onClose={closeCtxMenu}
        onCopy={() => {
          void canvasClipboardActions.copySelection(projectId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onPaste={() => {
          void canvasClipboardActions.pasteFromClipboard(projectId, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onDuplicate={() => {
          canvasClipboardActions.duplicateSelection(projectId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onDelete={() => {
          if (entityIds.length === 0) return;
          try {
            useAccountStore.getState().deleteFromProject({ projectId, nodeIds: entityIds });
            useSelectionStore.getState().clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "delete failed");
          }
          closeCtxMenu();
        }}
        onOpenProjectSettings={() => {
          closeCtxMenu();
          openProjectSettings();
        }}
        onMoveTo={(toProjectId) => {
          if (entityIds.length !== 1) return;
          try {
            useAccountStore.getState().moveMenuToProject({
              menuId: entityIds[0]! as MenuId,
              fromProjectId: projectId,
              toProjectId,
            });
            toast.success(`Moved to ${toProjectId}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "move failed");
          }
          closeCtxMenu();
        }}
        // Créer « ici » pose une position de planche : sans planche, l'entrée
        // n'a pas de sens et disparaît du menu contextuel.
        onCreateMenuAt={
          focusMode
            ? undefined
            : (world) => {
                closeCtxMenu();
                setPendingMenuPos(world);
              }
        }
        onCreateCommandAt={
          focusMode
            ? undefined
            : (world) => {
                setPendingCommandPos(world);
                closeCtxMenu();
              }
        }
        onCreateDialogAt={
          focusMode
            ? undefined
            : (world) => {
                closeCtxMenu();
                setPendingDialogPos(world);
              }
        }
      />
      <NewMenuDialog
        projectId={projectId}
        open={pendingMenuPos !== null}
        position={pendingMenuPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingMenuPos(null);
        }}
      />
      <NewCommandDialog
        projectId={projectId}
        open={pendingCommandPos !== null}
        position={pendingCommandPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingCommandPos(null);
        }}
      />
      <NewDialogDialog
        projectId={projectId}
        open={pendingDialogPos !== null}
        position={pendingDialogPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingDialogPos(null);
        }}
      />
    </div>
  );
}
