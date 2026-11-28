import type { Project, ProjectId } from "@/domain/types";
import { variantNames, viewedVariant } from "@/domain/variants";
import { useProjectsStore } from "@/state/projectsStore";
import { useViewAsStore } from "@/state/viewAsStore";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/**
 * Keeps "View as" in step with the editor's pick and the URL (`?variant=`). Variants are the
 * server's: the pick (`useViewAsStore`) holds for every module, and a module without a version
 * of that variant shows its own Documents, which is what the variant's players see there.
 * Once per Project, a variant in the URL (a reload, a shared link) becomes the pick; the
 * module shows the pick when it has its own versions for it, and the URL follows the pick.
 */
export function useVariantInUrl(project: Project | null, linked: string | undefined): void {
  const navigate = useNavigate();
  const picked = useViewAsStore((s) => s.variant);
  /** The Project whose URL variant was applied: done once, at its load. */
  const applied = useRef<string | null>(null);
  const viewed = project ? (viewedVariant(project) ?? project.originalView?.variant) : undefined;
  const projectId = project?.id;
  const has = !!picked && !!project && variantNames(project).includes(picked);
  /** The module's variants are not read yet: its view waits for them. */
  const pending = !!project && !project.variants && (!!picked || !!linked);

  useEffect(() => {
    if (!projectId || pending) return;
    if (applied.current !== projectId) {
      applied.current = projectId;
      if (linked && linked !== picked) {
        useViewAsStore.getState().set(linked);
        return;
      }
    }
    const shown = has ? picked : undefined;
    if (viewed !== shown) {
      useProjectsStore.getState().showVariant(projectId as ProjectId, shown);
      return;
    }
    if (linked === picked) return;
    void navigate({
      to: ".",
      search: (previous) => ({ ...(previous as object), variant: picked }),
      replace: true,
    });
  }, [projectId, linked, picked, viewed, has, pending, navigate]);
}
