import { EmptyState } from "@/components/ui/empty-state";
import { projectNamespace } from "@/domain/docRef";
import type { DataSource, Project, ProjectId } from "@/domain/types";
import { ConfigValueForm, SourceRowsTable } from "@/features/data/SourceValueEditor";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { getModule } from "@artisan/editor-sdk";
import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ResolvedProjectContext } from "../project/ResolvedProjectContext";
import { ModuleScreenView } from "./ModuleScreenView";
import { resolveScreen } from "./screenList";

/**
 * The Config screen of a module whose table lives in one of the server's Projects (its
 * module folder), opened inside that Project (ADR `module-config-screens`, amendment
 * 2026-10-24). It edits the Project's own working copy: changes go to its draft and reach
 * the server with Deploy, like its Documents, where the standalone screen
 * (`ConfigScreenPage`) wrote the file at once with its own Save button. A configuration
 * root (`role: config`) is not a listed Project and keeps the standalone screen.
 */
export function ProjectScreenView({
  projectId,
  screenId,
}: {
  projectId: ProjectId;
  screenId: string;
}) {
  const { t } = useTranslation();
  const resolvedId = useContext(ResolvedProjectContext) ?? projectId;
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === resolvedId));
  const declared = useServerScreensStore((s) => s.screens);
  const localProjects = useProjectsStore((s) => s.openProjects.projects);
  const screen = useMemo(
    () => resolveScreen(screenId, declared, localProjects),
    [screenId, declared, localProjects],
  );

  if (!project || !screen || !screenEditsProject(screen, project)) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState title={t("screens.notFound")} />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-auto" data-testid="project-screen">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6 md:p-8">
        <div className="min-w-0">
          <div className="eyebrow">{project.name}</div>
          <h1 className="truncate text-lg font-semibold">{screen.label}</h1>
        </div>
        <ProjectScreenForm project={project} screen={screen} />
      </div>
    </div>
  );
}

/**
 * The form of a Config screen on the Project's working copy: the module's own view, else
 * the generated table or form. Also shown at the top of a collection's page (SDK 1.9).
 */
export function ProjectScreenForm({
  project,
  screen,
}: {
  project: Project;
  screen: ServerEditorScreen;
}) {
  const { t } = useTranslation();
  const source = screenSource(project, screen);
  const moduleView =
    screen.component && screen.moduleId
      ? getModule(screen.moduleId)?.screens?.[screen.component]
      : undefined;
  if (!source) return <EmptyState title={t("screens.emptyTable")} hint={screen.table} />;
  if (moduleView)
    return (
      <ModuleScreenView view={moduleView} projectId={project.id} source={source} readOnly={false} />
    );
  return source.shape === "table" ? (
    <SourceRowsTable projectId={project.id} project={project} source={source} />
  ) : (
    <ConfigValueForm projectId={project.id} project={project} source={source} />
  );
}

/** The screen's table belongs to this Project (matched on its disk id). */
export function screenEditsProject(
  screen: Pick<ServerEditorScreen, "projectId">,
  project: { id: string; diskId?: string },
): boolean {
  return !!screen.projectId && screen.projectId === projectNamespace(project);
}

/** The Project source a screen edits: `data/<id>` is the source `<id>`. */
export function screenSource(
  project: Project,
  screen: Pick<ServerEditorScreen, "table">,
): DataSource | undefined {
  const id = screen.table.replace(/^data\//, "");
  return project.dataSources?.find((d) => (d.id as string) === id);
}
