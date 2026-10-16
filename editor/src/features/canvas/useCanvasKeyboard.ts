import { commandsOf, menusOf } from "@/domain/documents";
import type { Command, Element, ElementId, Menu, MenuId, ProjectId } from "@/domain/types";
import { isTypingTarget } from "@/lib/keyboard";
import { formatPositions, parsePositions } from "@/lib/positions";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import {
  CLIPBOARD_VERSION,
  type ElementCopy,
  readClipboard,
  rewriteIds,
  writeClipboard,
} from "./clipboard";
import { positionCount } from "./inventoryTypes";

/**
 * Locate an element by id within a project and return enough context
 * (the owning menu) to call element-scoped actions on it.
 */
const findElement = (
  projectId: ProjectId,
  elementId: ElementId,
  scopeMenuId?: string | null,
): { menuId: MenuId; element: Element } | null => {
  const openProjects = useProjectsStore.getState().openProjects;
  const project = openProjects.projects.find((p) => p.id === projectId);
  if (!project) return null;
  for (const menu of menusOf(project)) {
    // Element ids collide across menus — honour the selection's owning menu.
    if (scopeMenuId && menu.id !== scopeMenuId) continue;
    for (const layer of menu.layers) {
      const element = layer.elements.find((el) => el.id === elementId);
      if (element) return { menuId: menu.id, element };
    }
  }
  return null;
};

export const findSelectedEntities = (
  projectId: ProjectId,
  ids: string[],
  scopeMenuId?: string | null,
) => {
  const openProjects = useProjectsStore.getState().openProjects;
  const project = openProjects.projects.find((p) => p.id === projectId);
  if (!project)
    return { menus: [] as Menu[], commands: [] as Command[], elements: [] as ElementCopy[] };
  const idSet = new Set(ids);
  const elements: ElementCopy[] = [];
  for (const menu of menusOf(project)) {
    // Scope element matching to the selection's menu so a shared id (e.g.
    // `grid` in two menus) doesn't copy/duplicate both.
    if (scopeMenuId && menu.id !== scopeMenuId) continue;
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        if (idSet.has(el.id)) elements.push({ sourceMenuId: menu.id, element: el });
      }
    }
  }
  // A menu whose items are selected is only their container (e.g. the document
  // view keeps its menu selected): copying the items must not copy the menu.
  const owners = new Set(elements.map((e) => e.sourceMenuId));
  return {
    menus: menusOf(project).filter((m) => idSet.has(m.id) && !owners.has(m.id)),
    commands: commandsOf(project).filter((c) => idSet.has(c.id)),
    elements,
  };
};

/**
 * Pick the menu we should drop pasted elements into. Priority:
 *   1. A menu that is currently selected
 *   2. The menu that owns the currently selected element
 *   3. The clipboard's source menu (if it still exists in this project)
 *   4. The first menu in the project
 */
const resolveTargetMenu = (projectId: ProjectId, elements: ElementCopy[]): MenuId | null => {
  const openProjects = useProjectsStore.getState().openProjects;
  const project = openProjects.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const sel = [...useSelectionStore.getState().ids];
  for (const id of sel) {
    if (menusOf(project).some((m) => m.id === id)) return id as MenuId;
  }
  for (const id of sel) {
    for (const m of menusOf(project)) {
      if (m.layers.some((l) => l.elements.some((el) => el.id === id))) return m.id;
    }
  }
  for (const ec of elements) {
    if (menusOf(project).some((m) => m.id === ec.sourceMenuId)) return ec.sourceMenuId;
  }
  return menusOf(project)[0]?.id ?? null;
};

/**
 * Find the smallest non-negative linear delta `d` such that every position
 * in `original` shifted by `d` is within bounds AND not in `occupied`.
 * Returns null when nothing fits.
 */
const findFreePositions = (
  menu: Menu,
  original: number[],
  occupiedExtra?: ReadonlySet<number>,
): number[] | null => {
  const occupied = new Set<number>(occupiedExtra ?? []);
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      for (const p of parsePositions(el.positions)) occupied.add(p);
    }
  }
  const max = positionCount(menu.inventoryType ?? "chest", menu.rows, menu.playerInventory);
  for (let delta = 0; delta < max; delta++) {
    const shifted = original.map((p) => p + delta);
    if (shifted.every((p) => p < max && !occupied.has(p))) return shifted;
  }
  return null;
};

/** Slot the user pointed at for a paste: under the cursor, or right-clicked. */
export interface PasteAnchor {
  menuId: MenuId;
  position: number;
}

const placeElements = (
  projectId: ProjectId,
  menuId: MenuId,
  elements: ElementCopy[],
  options: { skipSourcePositions: boolean; anchor?: number },
  onError?: (m: string) => void,
) => {
  const openProjects = useProjectsStore.getState().openProjects;
  const project = openProjects.projects.find((p) => p.id === projectId);
  const menu = menusOf(project).find((m) => m.id === menuId);
  if (!menu) {
    onError?.("Target menu not found");
    return;
  }
  // We accumulate `extra` as we place elements so two clipboard items don't
  // land on top of each other.
  const extra = new Set<number>();
  // Anchored paste: shift the whole group so its first slot lands on the
  // anchor, keeping the elements' relative layout. A shifted element that
  // falls off the grid keeps its copied positions instead.
  const max = positionCount(menu.inventoryType ?? "chest", menu.rows, menu.playerInventory);
  const groupMin = Math.min(...elements.flatMap((ec) => parsePositions(ec.element.positions)));
  const anchorDelta =
    options.anchor !== undefined && Number.isFinite(groupMin) ? options.anchor - groupMin : 0;
  for (const ec of elements) {
    const copied = parsePositions(ec.element.positions);
    if (copied.length === 0) continue;
    const shifted = copied.map((p) => p + anchorDelta);
    const original = shifted.every((p) => p < max) ? shifted : copied;
    const initialOccupied = options.skipSourcePositions
      ? new Set([...extra, ...original])
      : new Set(extra);
    const fit = findFreePositions(menu, original, initialOccupied);
    if (!fit) {
      onError?.(`No room in menu ${menu.id} for the pasted button`);
      continue;
    }
    for (const p of fit) extra.add(p);
    const placed: Element = { ...ec.element, positions: formatPositions(fit) };
    try {
      useProjectsStore.getState().addElement({ projectId, menuId, element: placed });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "paste failed");
    }
  }
};

const copySelection = async (
  projectId: ProjectId,
  ids: string[],
  onError?: (m: string) => void,
) => {
  if (ids.length === 0) return;
  const { menus, commands, elements } = findSelectedEntities(
    projectId,
    ids,
    useSelectionStore.getState().menuId,
  );
  if (menus.length === 0 && commands.length === 0 && elements.length === 0) return;
  try {
    await writeClipboard({
      kind: "artisan.clipboard",
      version: CLIPBOARD_VERSION,
      menus,
      commands,
      elements,
    });
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "copy failed");
  }
};

const pasteFromClipboard = async (
  projectId: ProjectId,
  onError?: (m: string) => void,
  anchor?: PasteAnchor | null,
) => {
  const payload = await readClipboard();
  if (!payload) {
    onError?.("Clipboard is empty");
    return;
  }
  const rewritten = rewriteIds({
    menus: payload.menus,
    commands: payload.commands,
    elements: payload.elements,
  });
  try {
    if (rewritten.menus.length > 0 || rewritten.commands.length > 0) {
      useProjectsStore.getState().pasteEntities({
        projectId,
        menus: rewritten.menus,
        commands: rewritten.commands,
        offset: { x: 80, y: 80 },
      });
    }
    if (rewritten.elements.length > 0) {
      const targetMenu = anchor?.menuId ?? resolveTargetMenu(projectId, rewritten.elements);
      if (!targetMenu) {
        onError?.("No target menu — select a menu before pasting");
      } else {
        placeElements(
          projectId,
          targetMenu,
          rewritten.elements,
          { skipSourcePositions: false, anchor: anchor?.position },
          onError,
        );
      }
    }
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "paste failed");
  }
};

const duplicateSelection = (projectId: ProjectId, ids: string[], onError?: (m: string) => void) => {
  if (ids.length === 0) return;
  const { menus, commands, elements } = findSelectedEntities(
    projectId,
    ids,
    useSelectionStore.getState().menuId,
  );
  if (menus.length === 0 && commands.length === 0 && elements.length === 0) return;
  const rewritten = rewriteIds({ menus, commands, elements });
  try {
    if (rewritten.menus.length > 0 || rewritten.commands.length > 0) {
      useProjectsStore.getState().pasteEntities({
        projectId,
        menus: rewritten.menus,
        commands: rewritten.commands,
        offset: { x: 24, y: 24 },
      });
    }
    // Group element duplicates by their source menu so each lands in its own
    // menu. skipSourcePositions=true forces a non-zero shift so the duplicate
    // doesn't land on top of the original.
    const byMenu = new Map<MenuId, ElementCopy[]>();
    for (const ec of rewritten.elements) {
      const list = byMenu.get(ec.sourceMenuId) ?? [];
      list.push(ec);
      byMenu.set(ec.sourceMenuId, list);
    }
    for (const [menuId, list] of byMenu) {
      placeElements(projectId, menuId, list, { skipSourcePositions: true }, onError);
    }
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "duplicate failed");
  }
};

/** Delete menus/commands/dialogs and the selected items of menus alike. */
const deleteSelection = (projectId: ProjectId, ids: string[]) => {
  const store = useProjectsStore.getState();
  const { elements } = findSelectedEntities(projectId, ids, useSelectionStore.getState().menuId);
  for (const { sourceMenuId, element } of elements) {
    store.deleteElement({ projectId, menuId: sourceMenuId, elementId: element.id as ElementId });
  }
  const owners = new Set<string>(elements.map((e) => e.sourceMenuId));
  store.deleteFromProject({ projectId, nodeIds: ids.filter((id) => !owners.has(id)) });
};

interface UseCanvasKeyboardArgs {
  projectId: ProjectId;
  onError?: (message: string) => void;
  /** Slot under the cursor at paste time; null → the paste picks its own slot. */
  getPasteAnchor?: () => PasteAnchor | null;
}

export function useCanvasKeyboard({
  projectId,
  onError,
  getPasteAnchor,
}: UseCanvasKeyboardArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const cmdOrCtrl = e.ctrlKey || e.metaKey;

      if (!cmdOrCtrl && (e.key === "v" || e.key === "V")) {
        useUiStore.getState().setCanvasMode("select");
        return;
      }
      if (!cmdOrCtrl && (e.key === "h" || e.key === "H")) {
        useUiStore.getState().setCanvasMode("hand");
        return;
      }

      if (cmdOrCtrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useProjectsStore.temporal.getState().undo();
        return;
      }
      if (cmdOrCtrl && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        useProjectsStore.temporal.getState().redo();
        return;
      }
      if (cmdOrCtrl && e.key === "c") {
        // Let the browser handle it when the user has plain text selected.
        if (document.getSelection()?.toString()) return;
        e.preventDefault();
        const ids = [...useSelectionStore.getState().ids];
        void copySelection(projectId, ids, onError);
        return;
      }
      if (cmdOrCtrl && e.key === "v") {
        e.preventDefault();
        void pasteFromClipboard(projectId, onError, getPasteAnchor?.());
        return;
      }
      if (cmdOrCtrl && e.key === "d") {
        e.preventDefault();
        const ids = [...useSelectionStore.getState().ids];
        duplicateSelection(projectId, ids, onError);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = useSelectionStore.getState();
        const flow = useFlowSelectionStore.getState();
        const ids = [...sel.ids];

        // Flow sub-selection takes priority: if the user is editing a
        // specific state or step, Delete should remove that node rather
        // than the whole entity.
        if (flow.sub) {
          e.preventDefault();
          try {
            if (flow.sub.kind === "step" && ids.length === 1) {
              const id = ids[0]!;
              if (flow.sub.clickType !== undefined && flow.sub.stateIndex !== undefined) {
                const candidate = findElement(projectId, id as ElementId, sel.menuId);
                if (candidate) {
                  useProjectsStore.getState().removeElementStep({
                    projectId,
                    menuId: candidate.menuId,
                    elementId: id as ElementId,
                    appearanceIndex: flow.sub.stateIndex,
                    clickType: flow.sub.clickType,
                    path: flow.sub.path,
                  });
                  flow.clear();
                  return;
                }
              }
              // Command step (no clickType / stateIndex on the sub).
              useProjectsStore.getState().removeCommandStep({
                projectId,
                commandId: id as never,
                path: flow.sub.path,
              });
              flow.clear();
              return;
            }
            if (flow.sub.kind === "state" && ids.length === 1) {
              const candidate = findElement(projectId, ids[0]! as ElementId, sel.menuId);
              if (candidate && flow.sub.stateIndex > 0) {
                // Default state (index 0) is protected.
                useProjectsStore.getState().removeAppearance({
                  projectId,
                  menuId: candidate.menuId,
                  elementId: ids[0]! as ElementId,
                  appearanceIndex: flow.sub.stateIndex,
                });
                flow.clear();
                return;
              }
            }
          } catch (err) {
            onError?.(err instanceof Error ? err.message : "delete failed");
            return;
          }
        }

        if (ids.length === 0) return;
        e.preventDefault();
        try {
          // If the lone selection is an element, honour the selection mode:
          //   instance mode (focusedSlot set) → drop only that position
          //   button mode (focusedSlot null)  → delete the whole element
          if (ids.length === 1) {
            const candidate = findElement(projectId, ids[0]! as ElementId, sel.menuId);
            if (candidate) {
              const elementId = ids[0]! as ElementId;
              const places = candidate.element.places;
              if (sel.focusedSlot != null && places) {
                // Placement mode: instance-delete removes the pinned row at
                // this slot (clearSlot matches by `positions`, which is empty
                // on placement elements — it would silently no-op). No
                // placement at the slot → fall through to whole-element delete
                // so zombie elements stay deletable.
                const page = usePaginationStore.getState().pageByElement[elementId] ?? 0;
                const hit = places.placements.find(
                  (p) => p.position === sel.focusedSlot && p.page === page,
                );
                if (hit) {
                  useProjectsStore.getState().removeElementPlacement({
                    projectId,
                    menuId: candidate.menuId,
                    elementId,
                    key: hit.key,
                  });
                } else {
                  useProjectsStore.getState().deleteElement({
                    projectId,
                    menuId: candidate.menuId,
                    elementId,
                  });
                }
              } else if (sel.focusedSlot != null) {
                useProjectsStore.getState().clearSlot({
                  projectId,
                  menuId: candidate.menuId,
                  position: sel.focusedSlot,
                });
              } else {
                useProjectsStore.getState().deleteElement({
                  projectId,
                  menuId: candidate.menuId,
                  elementId,
                });
              }
              useSelectionStore.getState().clear();
              return;
            }
          }
          deleteSelection(projectId, ids);
          useSelectionStore.getState().clear();
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "delete failed");
        }
      }

      if (e.key === "Escape") {
        // Esc clears the deepest selection first (flow → entity).
        const flow = useFlowSelectionStore.getState();
        if (flow.sub) {
          flow.clear();
          return;
        }
        useSelectionStore.getState().clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectId, onError, getPasteAnchor]);
}

export const canvasClipboardActions = {
  copySelection,
  pasteFromClipboard,
  duplicateSelection,
  deleteSelection,
};
