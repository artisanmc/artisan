import { originStatus } from "@/domain/originals";
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

/**
 * In a module that ships originals (design `originaux-modules`): whether the Document is the
 * owner's version over the module's, or the owner's own ("" when it is the module's as is).
 */
export function useOriginTag(
  projectId: ProjectId,
  kind: string,
  id: string,
): "" | "modified" | "added" {
  return useProjectsStore((s) => {
    const p = s.openProjects.projects.find((x) => x.id === projectId);
    const status = p ? originStatus(p, kind, id) : undefined;
    return status === "modified" || status === "added" ? status : "";
  });
}

/** Right of the line above a Document: the owner's version, or the owner's own. */
export function OriginTag({
  status,
  width,
  y = -14,
}: {
  status: "modified" | "added";
  width: number;
  y?: number;
}) {
  const { t } = useTranslation();
  return (
    <Text
      y={y}
      width={width}
      align="right"
      wrap="none"
      text={t(status === "modified" ? "originals.tagModified" : "originals.tagAdded")}
      fontFamily="ui-monospace, monospace"
      fontSize={10}
      fill={status === "modified" ? "#fbbf24" : "#86efac"}
      listening={false}
    />
  );
}
