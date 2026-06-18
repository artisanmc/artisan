import { Button } from "@/components/ui/button";
import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { NewProjectDialog } from "./NewProjectDialog";
import { ProjectMini } from "./ProjectMini";

interface ProjectMiniSidebarProps {
  activeProjectId: ProjectId;
  /** When true, render without the fixed-width aside chrome — caller positions it. */
  embedded?: boolean;
}

export function ProjectMiniSidebar({ activeProjectId, embedded }: ProjectMiniSidebarProps) {
  const account = useAccountStore((s) => s.account);
  const reorderProjects = useAccountStore((s) => s.reorderProjects);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { t } = useTranslation();

  const orderedProjects = account.projectOrder
    .map((id) => account.projects.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = account.projectOrder.indexOf(active.id as ProjectId);
    const newIndex = account.projectOrder.indexOf(over.id as ProjectId);
    reorderProjects(arrayMove(account.projectOrder, oldIndex, newIndex));
  };

  const inner = (
    <>
      <header className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase text-[var(--text-faint)]">{t("projectMini.sidebarTitle")}</span>
        <NewProjectDialog
          trigger={
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-base leading-none">
              +
            </Button>
          }
        />
      </header>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={account.projectOrder} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {orderedProjects.map((pack) => (
              <div key={pack.id} className="relative">
                <ProjectMini pack={pack} active={pack.id === activeProjectId} />
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  );

  if (embedded) {
    return (
      <div data-pack-mini-sidebar="true" className="flex h-full flex-col gap-2 overflow-y-auto p-3">
        {inner}
      </div>
    );
  }

  return (
    <aside
      data-pack-mini-sidebar="true"
      className="hidden w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-[var(--border-soft)] bg-[var(--surface)] p-3 lg:flex"
    >
      {inner}
    </aside>
  );
}
