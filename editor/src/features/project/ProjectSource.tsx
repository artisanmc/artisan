import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project, ProjectId } from "@/domain/types";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useOtherServerProjects } from "@/features/serverIndex/useOtherServerProjects";
import { useProjectsStore } from "@/state/projectsStore";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const HERE = "__here__";
/**
 * Every project of the server at once, the edited one first, for when you don't
 * know where a resource lives.
 */
export const ALL_PROJECTS = "__all__";
/** What a library shows: the edited project (`null`), one other project, or all of them. */
export type ProjectSourceId = ProjectId | typeof ALL_PROJECTS | null;

/**
 * Lets a library show the images and items of the other projects of the same
 * server, one of them or all of them at once. They come from the server index
 * the project view already loads (their published state): nothing is read
 * twice. "All modules" also lists the edited project, first and read live from
 * the projects store: a child tells it apart by its id (`projectId`) and uses
 * its resources in place instead of copying them.
 */
export function ProjectSource({
  projectId,
  sourceId,
  onSourceChange,
  children,
  menuClassName,
}: {
  projectId: ProjectId;
  /** The project shown, `null` for `projectId` itself. */
  sourceId: ProjectSourceId;
  onSourceChange: (sourceId: ProjectSourceId) => void;
  /**
   * What to show for the choice: `null` is the project being edited alone,
   * otherwise the projects shown (one other, or all of them with the edited one
   * first; never empty).
   */
  children: (sources: Project[] | null) => ReactNode;
  /** Classes of the menu's own row. */
  menuClassName?: string;
}) {
  const { t } = useTranslation();
  const others = useOtherServerProjects(projectId);
  const here = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const status = useServerIndexStore((s) => s.status);
  const all = sourceId === ALL_PROJECTS;
  const source = sourceId && !all ? others.find((p) => p.id === sourceId) : undefined;
  const sources = all ? (here ? [here, ...others] : others) : source ? [source] : [];
  const loading = status === "loading";
  return (
    <>
      <div className={menuClassName}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="project-source"
              className="flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-left text-xs hover:border-[var(--border-strong)] lg:min-h-8"
            >
              <span className="text-[var(--text-mut)]">{t("projectSource.label")}</span>
              <span className="min-w-0 flex-1 truncate">
                {all ? t("projectSource.all") : (source?.name ?? t("projectSource.here"))}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-[var(--text-mut)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-80 overflow-y-auto border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
          >
            <DropdownMenuRadioGroup
              value={all ? ALL_PROJECTS : source ? source.id : HERE}
              onValueChange={(value) =>
                onSourceChange(value === HERE ? null : (value as ProjectSourceId))
              }
            >
              <DropdownMenuRadioItem value={HERE} className="text-xs">
                {t("projectSource.here")}
              </DropdownMenuRadioItem>
              {others.length > 0 && (
                <DropdownMenuRadioItem value={ALL_PROJECTS} className="text-xs">
                  {t("projectSource.all")}
                </DropdownMenuRadioItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] text-[var(--text-mut)]">
                {t("projectSource.others")}
              </DropdownMenuLabel>
              {others.map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {others.length > 0 ? null : loading ? (
              <output className="block px-2 py-1 text-[11px] text-[var(--text-faint)]">
                {t("projectSource.loading")}
              </output>
            ) : status === "unavailable" ? (
              <p role="alert" className="px-2 py-1 text-[11px] text-[var(--warning)]">
                {t("projectSource.unavailable")}
              </p>
            ) : (
              <p className="px-2 py-1 text-[11px] text-[var(--text-faint)]">
                {t("projectSource.none")}
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {sourceId === null ? (
        children(null)
      ) : sources.length > 0 ? (
        children(sources)
      ) : (
        <output className="block py-4 text-center text-xs text-[var(--text-mut)]">
          {t(loading ? "projectSource.loading" : "projectSource.gone")}
        </output>
      )}
    </>
  );
}
