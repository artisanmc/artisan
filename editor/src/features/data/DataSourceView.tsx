import { EmptyState } from "@/components/ui/empty-state";
import { dataSourceModule } from "@/domain/projectData";
import { screenOfSource } from "@/domain/projectData";
import type { ProjectId } from "@/domain/types";
import { isTypingTarget } from "@/lib/keyboard";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ProjectScreenForm } from "../screens/ProjectScreenView";
import { DataSourceEditor } from "./DataSourceEditor";

/**
 * The page of one of a Project's own data sources (`…/data/$dataSourceId`), opened from
 * its row in the sidebar: the table or config sheet editor, over the board. A source a
 * module's model types is not edited here (its module's screen is), nor listed. One a
 * module's screen edits is not listed either; an old link to it shows that screen's form.
 */
export function DataSourceView({
  projectId,
  dataSourceId,
}: {
  /** The resolved Project id (the route resolves the URL's folder name). */
  projectId: ProjectId;
  dataSourceId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const source = project?.dataSources?.find((d) => String(d.id) === dataSourceId);
  const editable = !!project && !!source && dataSourceModule(project, source) === null;
  const screens = useServerScreensStore((s) => s.screens);
  const screen =
    project && source ? screenOfSource(project, String(source.id), screens) : undefined;

  const back = useCallback(
    () => navigate(projectDestination(project ?? projectId, serverId)),
    [navigate, project, projectId, serverId],
  );

  // Escape goes back to the board, like a Document's view — unless an input or an open
  // menu/dialog owns it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  return (
    <div className="absolute inset-0 flex flex-col gap-3 overflow-hidden bg-[var(--surface)] p-3 md:p-4">
      <div className="flex shrink-0">
        <button
          type="button"
          onClick={back}
          className="btn btn-ghost btn-sm inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <ArrowLeft className="size-4" /> {t("documentView.back")}
          <kbd className="ml-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-faint)]">
            Esc
          </kbd>
        </button>
      </div>
      <main className="card flex min-h-0 flex-1 flex-col overflow-auto p-[var(--page-pad)]">
        {project && screen ? (
          <ProjectScreenForm project={project} screen={screen} />
        ) : project && source && editable ? (
          <DataSourceEditor projectId={project.id} source={source} onRemoved={back} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState title={t("dataSources.notFound")} />
          </div>
        )}
      </main>
    </div>
  );
}
