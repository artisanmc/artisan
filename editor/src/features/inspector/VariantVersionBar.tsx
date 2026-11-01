import { Button } from "@/components/ui/button";
import { parseDocKey } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { VARIANT_KINDS, versionOf, viewedVariant } from "@/domain/variants";
import { useProjectsStore } from "@/state/projectsStore";
import { Copy, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * While the canvas shows a variant: whose version the selected Document is, and the way to
 * give the variant its own (design `variantes-modules` §9, "Modifier un élément hérité").
 */
export function VariantVersionBar({
  projectId,
  project,
  docKey,
}: {
  projectId: ProjectId;
  project: Project;
  docKey: string;
}) {
  const { t } = useTranslation();
  const variant = viewedVariant(project);
  const ref = parseDocKey(docKey);
  if (!variant || !ref) return null;
  const variable = VARIANT_KINDS.includes(ref.kind);
  const own = versionOf(project, ref.kind, ref.id) === variant;
  const store = useProjectsStore.getState();
  return (
    <div
      data-testid="variant-version-bar"
      className="mx-3 mb-2 flex flex-col gap-1.5 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-inset)] p-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <span className={own ? "badge badge-sage" : "badge"}>
          {own ? t("variants.ownVersion", { name: variant }) : t("variants.inherited")}
        </span>
        {!own && <span className="text-[var(--text-mut)]">{t("variants.editShared")}</span>}
      </div>
      {variable && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          title={t(own ? "variants.dropVersionHint" : "variants.createVersionHint", {
            name: variant,
          })}
          onClick={() =>
            own
              ? store.dropVersion(projectId, ref.kind, ref.id)
              : store.createVersion(projectId, ref.kind, ref.id)
          }
        >
          {own ? <Undo2 className="size-4" /> : <Copy className="size-4" />}
          {t(own ? "variants.dropVersion" : "variants.createVersion", { name: variant })}
        </Button>
      )}
    </div>
  );
}
