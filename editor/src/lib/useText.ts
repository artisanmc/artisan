import type { LText, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { useCallback } from "react";

export function useGetText(projectId: ProjectId): (lt: LText | undefined) => string {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  return useCallback(
    (lt) => (project && lt ? getText(project, lt, activeLang) : ""),
    [project, activeLang],
  );
}

/**
 * Resolved text + active language for callers that also need to dispatch
 * a write back through the appropriate store mutator. Saves a duplicate
 * `useUiStore` subscription at the call site.
 */
export function useTextEdit(
  projectId: ProjectId,
  lt: LText | undefined,
): { value: string; lang: string; isFallback: boolean } {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!project || !lt) return { value: "", lang: activeLang, isFallback: false };
  const entry = project.i18nKeys[lt.key];
  const direct = entry?.[activeLang];
  if (direct !== undefined) return { value: direct, lang: activeLang, isFallback: false };
  const fallback = entry?.[project.defaultLang] ?? "";
  return { value: fallback, lang: activeLang, isFallback: fallback !== "" };
}
