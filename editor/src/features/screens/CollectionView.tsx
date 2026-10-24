import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { documentsOf } from "@/domain/documents";
import type { ProjectId } from "@/domain/types";
import { NewDocumentDialog } from "@/features/canvas/NewDocumentDialog";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { collectionLabel } from "@/lib/documentCollections";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { contributionLabel, documentTitle, kindCreatableIn } from "@/lib/moduleDocumentKinds";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResolvedProjectContext } from "../project/ResolvedProjectContext";
import { ProjectScreenForm, screenEditsProject } from "./ProjectScreenView";
import { resolveScreen } from "./screenList";

/**
 * The page of a collection kind's Documents in a project (SDK 1.9), a shop's catalogue: the
 * collection's settings screen when it declares one, then a card per Document and the
 * button that creates one. A card opens its Document on its own view.
 */
export function CollectionView({ projectId, kind }: { projectId: ProjectId; kind: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  const resolvedId = useContext(ResolvedProjectContext) ?? projectId;
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === resolvedId));
  const localProjects = useProjectsStore((s) => s.openProjects.projects);
  const declared = useServerScreensStore((s) => s.screens);
  const uiLang = useUiStore((s) => s.editorLang);
  const activeLang = useUiStore((s) => s.activeLang);
  const [creating, setCreating] = useState(false);
  const contribution = documentKindContribution(kind);
  const screenId = contribution?.collection?.screen;
  const screen = useMemo(
    () => (screenId ? resolveScreen(screenId, declared, localProjects) : null),
    [screenId, declared, localProjects],
  );

  if (!project || !contribution?.collection) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState title={t("collections.notFound")} />
      </div>
    );
  }

  const label = collectionLabel(contribution, kind, uiLang);
  const kindLabel = contributionLabel(contribution, kind, t, uiLang);
  const docs = documentsOf(project, kind);
  const look = kindAppearance(kind);
  const open = (id: string) => navigate(projectDestination(project, serverId, id, kind));

  return (
    <div className="absolute inset-0 overflow-auto" data-testid="collection-page">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-8">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="eyebrow">{project.name}</div>
            <h1 className="truncate text-lg font-semibold">{label}</h1>
            <p className="text-[13px] text-[var(--text-mut)]">
              {t("collections.count", { count: docs.length, kind: kindLabel })}
            </p>
          </div>
          {kindCreatableIn(contribution, project) && (
            <button
              type="button"
              className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" aria-hidden />
              {t("projectProperties.newDocument", { kind: kindLabel })}
            </button>
          )}
        </div>

        {screen && screenEditsProject(screen, project) && (
          <section className="flex flex-col gap-3" aria-label={screen.label}>
            <h2 className="field-label">{screen.label}</h2>
            <ProjectScreenForm project={project} screen={screen} />
          </section>
        )}

        {docs.length === 0 ? (
          <EmptyState title={t("collections.empty", { collection: label })} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => open(doc.id)}
                  className="card flex w-full items-center gap-3 p-3 text-left hover:border-[var(--border)] hover:bg-[var(--surface-hover)]"
                >
                  <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <MiniMessageInline
                      source={documentTitle(contribution, doc, project, activeLang)}
                      className="truncate text-[13px] font-medium text-[var(--text)]"
                    />
                    <span className="truncate text-[12px] text-[var(--text-mut)]">
                      {contribution.board?.summary?.(doc, { project, lang: activeLang }) ?? doc.id}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && (
        <NewDocumentDialog
          projectId={project.id}
          kind={kind}
          open
          onOpenChange={(o) => {
            if (!o) setCreating(false);
          }}
          onCreated={open}
        />
      )}
    </div>
  );
}
