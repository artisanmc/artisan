import { cx } from "@/lib/cx";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface SortableListProps {
  /** One stable id per row, in order: a row keeps its id when it moves. */
  ids: readonly string[];
  /** The row at `from` is dropped at `to` (both indexes in `ids`; `arrayMove` semantics). */
  onMove: (from: number, to: number) => void;
  /** A row's content; `handle` is its drag handle, placed where the row wants it. */
  children: (index: number, handle: ReactElement) => ReactNode;
  /** Classes of the `<ul>`. */
  className?: string;
  /** Classes of each `<li>`. */
  itemClassName?: string;
  /** The handle's accessible name (default: "Drag to reorder"). */
  handleLabel?: string;
}

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * A vertical list reordered by a grip handle (dnd-kit): drag it with the pointer, or focus
 * it and use Space then ↑/↓ then Space. The row follows the pointer on the vertical axis
 * only; nothing changes until the drop, which calls `onMove` once. Lists nest: each has its
 * own context, so a row of an inner list never lands in the outer one.
 */
export function SortableList({
  ids,
  onMove,
  children,
  className,
  itemClassName,
  handleLabel,
}: SortableListProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || over.id === active.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  };
  const label = handleLabel ?? t("sortableList.handle");
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids as string[]} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {ids.map((id, index) => (
            <SortableRow key={id} id={id} className={itemClassName} label={label}>
              {(handle) => children(index, handle)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  className,
  label,
  children,
}: {
  id: string;
  className?: string;
  label: string;
  children: (handle: ReactElement) => ReactNode;
}) {
  const s = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={s.setActivatorNodeRef}
      {...s.attributes}
      {...s.listeners}
      aria-label={label}
      title={label}
      data-drag-handle="true"
      className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded text-[var(--text-faint)] transition-colors hover:text-[var(--text-mut)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand)] active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
  return (
    <li
      ref={s.setNodeRef}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
        // The dragged row floats above its neighbours.
        position: s.isDragging ? "relative" : undefined,
        zIndex: s.isDragging ? 1 : undefined,
      }}
      className={cx(className, s.isDragging && "opacity-80 shadow-lg")}
      data-dragging={s.isDragging || undefined}
    >
      {children(handle)}
    </li>
  );
}
