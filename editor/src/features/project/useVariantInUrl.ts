import type { Project, ProjectId } from "@/domain/types";
import { variantNames, viewedVariant } from "@/domain/variants";
import { useProjectsStore } from "@/state/projectsStore";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/**
 * Keeps "View as" in the URL (`?variant=`): a reload, or a shared link, shows the same
 * variant. Once per Project, the URL's variant is shown if the module has it; from then on
 * the URL follows the view, and a variant the module does not have is dropped from it.
 */
export function useVariantInUrl(project: Project | null, urlVariant: string | undefined): void {
  const navigate = useNavigate();
  /** The Project whose URL variant was applied: done once, at its load. */
  const applied = useRef<string | null>(null);
  const viewed = project ? (viewedVariant(project) ?? project.originalView?.variant) : undefined;
  const projectId = project?.id;
  const names = project ? variantNames(project) : [];
  const known = !!urlVariant && names.includes(urlVariant);
  /** The module's variants are not read yet: the URL's variant waits for them. */
  const pending = !!urlVariant && !!project && !project.variants;

  useEffect(() => {
    if (!projectId || pending) return;
    if (applied.current !== projectId) {
      applied.current = projectId;
      if (known && urlVariant !== viewed) {
        useProjectsStore.getState().showVariant(projectId as ProjectId, urlVariant);
        return;
      }
    }
    if (viewed === urlVariant) return;
    void navigate({
      to: ".",
      search: (previous) => ({ ...(previous as object), variant: viewed }),
      replace: true,
    });
  }, [projectId, urlVariant, viewed, known, pending, navigate]);
}
