import type { ProjectId } from "@/domain/types";
import { VARIANT_KINDS, versionOf, viewedVariant } from "@/domain/variants";
import { useProjectsStore } from "@/state/projectsStore";
import { useTranslation } from "react-i18next";
import { Text } from "react-konva";

/**
 * While the canvas shows a variant: whether a Document is that variant's version or the
 * module's, shared ("" when no variant is shown or the kind has no versions).
 */
export function useVariantStatus(
  projectId: ProjectId,
  kind: string,
  id: string,
): "" | "own" | "inherited" {
  return useProjectsStore((s) => {
    const p = s.openProjects.projects.find((x) => x.id === projectId);
    if (!p || !viewedVariant(p) || !VARIANT_KINDS.includes(kind)) return "";
    return versionOf(p, kind, id) ? "own" : "inherited";
  });
}

/** Opacity of a Document the viewed variant inherits from the module. */
export const INHERITED_OPACITY = 0.5;

/** The line above a Document while a variant is shown: its version, or the module's. */
export function VariantTag({
  projectId,
  status,
  width,
  y = -14,
}: {
  projectId: ProjectId;
  status: "own" | "inherited";
  width: number;
  y?: number;
}) {
  const { t } = useTranslation();
  const variant = useProjectsStore((s) => {
    const p = s.openProjects.projects.find((x) => x.id === projectId);
    return p ? viewedVariant(p) : undefined;
  });
  return (
    <Text
      y={y}
      width={width}
      wrap="none"
      ellipsis
      text={
        status === "own" ? t("variants.ownVersion", { name: variant }) : t("variants.inherited")
      }
      fontFamily="ui-monospace, monospace"
      fontSize={10}
      fill={status === "own" ? "#86efac" : "#9ca3af"}
      listening={false}
    />
  );
}
