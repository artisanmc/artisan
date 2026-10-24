import type { ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ProjectDocumentItem, buildProjectDocuments } from "./useProjectDocuments";

/**
 * Dragging a Document row in the sidebar to file it: the row follows the pointer, and
 * the folder under it opens a gap where the Document will sit. The order stays the
 * tree's own (kind, then label): only the folder changes.
 */
export interface DocumentDrag {
  /** The dragged Document's key (`docKey`). */
  key: string | null;
  /** The folder under the pointer (`""`: the module's root); `null` over none. */
  target: string | null;
}

const NONE: DocumentDrag = { key: null, target: null };
const DragState = createContext<DocumentDrag>(NONE);
export const useDocumentDrag = () => useContext(DragState);

const FOLDER = "folder:";
const folderOf = (overId: string | number) => String(overId).slice(FOLDER.length);

/** A folder's drop zone (`""`: the module's root). */
export function useFolderDroppable(path: string, enabled: boolean) {
  return useDroppable({ id: `${FOLDER}${path}`, disabled: !enabled });
}

/** The innermost zone under the pointer: a folder wins over the folders around it. */
const innermost: CollisionDetection = (args) => {
  const area = (id: string | number) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  return pointerWithin(args).sort((a, b) => area(a.id) - area(b.id));
};

/** Files the dragged Document where it was dropped (`overId`: a folder's zone). */
export function dropDocument(projectId: ProjectId, key: string, overId: string | number | null) {
  if (overId === null || !String(overId).startsWith(FOLDER)) return;
  useProjectsStore.getState().moveToFolder({ projectId, nodeIds: [key], folder: folderOf(overId) });
}

/**
 * The tree as it will be once the drag drops: the dragged Document already in the
 * folder under the pointer, at the place the tree's order gives it there.
 */
export function withDropPreview(
  groups: ReturnType<typeof buildProjectDocuments>,
  drag: DocumentDrag,
  keyOf: (item: ProjectDocumentItem) => string,
): ReturnType<typeof buildProjectDocuments> {
  if (drag.key === null || drag.target === null) return groups;
  return groups.map((g) => ({
    ...g,
    items: g.items.map((it) => (keyOf(it) === drag.key ? { ...it, folder: drag.target! } : it)),
  }));
}

/** The drag area of a project's tree. `overlay`: what follows the pointer. */
export function DocumentDragArea({
  projectId,
  overlay,
  children,
}: {
  projectId: ProjectId;
  overlay: (key: string) => ReactNode;
  children: ReactNode;
}) {
  // A few pixels before a drag starts: a click still opens the Document.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [drag, setDrag] = useState<DocumentDrag>(NONE);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={innermost}
      // The preview reshapes the tree as the pointer moves: measure the folders again.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={(e) => setDrag({ key: String(e.active.id), target: null })}
      onDragOver={(e) => setDrag((d) => ({ ...d, target: e.over ? folderOf(e.over.id) : null }))}
      onDragEnd={(e) => {
        dropDocument(projectId, String(e.active.id), e.over?.id ?? null);
        setDrag(NONE);
      }}
      onDragCancel={() => setDrag(NONE)}
    >
      <DragState.Provider value={drag}>{children}</DragState.Provider>
      {/* On the body: an ancestor's transform would offset a fixed overlay. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>{drag.key ? overlay(drag.key) : null}</DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

/**
 * Rows (`[data-flip]`) glide to their new place instead of jumping, while a drag
 * reshapes the tree.
 */
export function useGlidingRows(container: RefObject<HTMLElement | null>, active: boolean) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = container.current?.querySelectorAll<HTMLElement>("[data-flip]") ?? [];
    const next = new Map<string, number>();
    for (const row of rows) {
      const id = row.dataset.flip!;
      const top = row.getBoundingClientRect().top;
      next.set(id, top);
      const before = tops.current.get(id);
      if (active && before !== undefined && before !== top && typeof row.animate === "function") {
        row.animate(
          [{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }],
          { duration: 160, easing: "ease-out" },
        );
      }
    }
    tops.current = next;
  });
}
