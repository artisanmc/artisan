import type { Project } from "@/domain/types";
import { validActiveLang } from "@/lib/i18nUsages";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";

/**
 * The active language is persisted globally: a project that lost that
 * language (lang/ files removed) must fall back to its default language.
 */
export function useActiveLangFallback(project: Project | null): void {
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  useEffect(() => {
    if (!project) return;
    const lang = validActiveLang(project, activeLang);
    if (lang !== activeLang) setActiveLang(lang);
  }, [project, activeLang, setActiveLang]);
}
