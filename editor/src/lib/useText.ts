import type { LText, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useCallback } from "react";

/**
 * React bridge for `getText`. Subscribes to the project ref (immer keeps it
 * stable across unrelated edits) and the active language so the value
 * re-renders when either changes.
 *
 * For components that resolve many `LText` refs in one render, prefer
 * `useGetText` below — it returns a stable resolver and avoids one
 * subscription per call.
 */
export function useText(projectId: ProjectId, lt: LText | undefined): string {
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!project || !lt) return "";
  return getText(project, lt, activeLang);
}

export function useGetText(projectId: ProjectId): (lt: LText | undefined) => string {
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
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
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!project || !lt) return { value: "", lang: activeLang, isFallback: false };
  const entry = project.i18nKeys[lt.key];
  const direct = entry?.[activeLang];
  if (direct !== undefined) return { value: direct, lang: activeLang, isFallback: false };
  const fallback = entry?.[project.defaultLang] ?? "";
  return { value: fallback, lang: activeLang, isFallback: fallback !== "" };
}
