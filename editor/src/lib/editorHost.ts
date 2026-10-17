import type { I18nKey, Project, ProjectId } from "@/domain/types";
import { getText, newI18nKey } from "@/lib/i18n";
import { fieldTextOf } from "@/schema/fieldText";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { type EditorHost, type HostComponents, installEditorHost } from "@artisan/editor-sdk";
import { toast } from "sonner";

/** The project's languages: its default, then every other one a text holds. */
export function projectLanguages(project: Project): string[] {
  const langs = new Set<string>([project.defaultLang]);
  for (const entry of Object.values(project.i18nKeys)) {
    for (const lang of Object.keys(entry ?? {})) langs.add(lang);
  }
  return [...langs];
}

/**
 * The editor as `@artisan/editor-sdk` exposes it to a module's views (ADR
 * `runtime-editor-modules`): the same stores the core views use, behind the SDK's
 * narrow contract, so a bundle never imports the editor's internals.
 */
export const editorHost: Omit<EditorHost, "components"> = {
  useProject: (projectId) =>
    useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId)),
  useContentLang: () => useUiStore((s) => s.activeLang),
  useUiLang: () => useUiStore((s) => s.editorLang),
  updateDocument: ({ projectId, kind, id, doc, texts }) =>
    useProjectsStore
      .getState()
      .updateDocument({ projectId: projectId as ProjectId, kind, id, doc, texts }),
  newTextKey: () => newI18nKey(),
  text: (project, key, lang) => getText(project as Project, { key: key as I18nKey }, lang),
  fieldText: (project, key) => fieldTextOf(project as Project)(key as I18nKey),
  langs: (project) => projectLanguages(project as Project),
  notify: (message, tone) => (tone === "error" ? toast.error(message) : toast(message)),
};

/** `components`: the editor widgets module views embed (`distribution/hostComponents.tsx`). */
export function installHost(components: HostComponents): void {
  installEditorHost({ ...editorHost, components });
}
