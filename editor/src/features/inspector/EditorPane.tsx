import { Button } from "@/components/ui/button";
import type { ProjectId } from "@/domain/types";
import { SelectionInspector } from "@/features/inspector/SelectionInspector";
import { DocumentYamlView, documentRelPath } from "@/features/project/DocumentYamlView";
import { dismissInspector } from "@/features/project/projectSettings";
import { selectionContext } from "@/features/project/selectionContext";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function EditorPane({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const ids = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const projectSettingsOpen = useUiStore((s) => s.projectSettingsOpen);
  const [yamlMode, setYamlMode] = useState(false);

  // An element has no file of its own: show its menu's.
  const ctx = selectionContext(project, ids, selectionMenuId);
  const docId =
    ctx.kind === "menu" || ctx.kind === "element"
      ? ctx.menuId
      : ctx.kind === "command" || ctx.kind === "dialog" || ctx.kind === "document"
        ? ctx.id
        : null;
  const relPath =
    project && docId
      ? documentRelPath(project, docId)
      : project && ids.size === 0 && projectSettingsOpen
        ? "manifest.yaml"
        : null;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("projectLibrary.properties")}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="flex-1 text-sm font-medium">{t("projectLibrary.properties")}</h2>
        {relPath ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="editor-pane-yaml"
            aria-pressed={yamlMode}
            onClick={() => setYamlMode((v) => !v)}
            title={relPath}
          >
            {yamlMode ? t("yamlView.visual") : t("yamlView.tab")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="editor-pane-close"
          onClick={dismissInspector}
          aria-label={t("editorPane.close")}
          title={t("editorPane.close")}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {yamlMode && project && relPath ? (
          <DocumentYamlView key={relPath} project={project} relPath={relPath} />
        ) : (
          <SelectionInspector projectId={projectId} />
        )}
      </div>
    </section>
  );
}
