import { Breadcrumb, BreadcrumbCurrent, breadcrumbLinkClass } from "@/components/ui/breadcrumb";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import type { DocumentTrail } from "@/state/documentTrailStore";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * The module, at the head of its header, then the open Document's levels (its collection,
 * itself, its selected part). With a Document open, the module and the collection lead
 * back to their pages. The server is not repeated here: it is the sidebar's first row,
 * which switches servers too. `status` (the server's state while it is down) comes first.
 */
export function ProjectBreadcrumb({
  projectName,
  status,
  trail,
}: {
  projectName: string;
  status?: ReactNode;
  /** The open Document, from `DocumentView`. */
  trail?: DocumentTrail | null;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-1">
      {status}
      <Breadcrumb label={t("breadcrumb.label")}>
        {trail ? (
          <button
            type="button"
            onClick={trail.toProject}
            title={projectName}
            className={breadcrumbLinkClass}
          >
            {projectName}
          </button>
        ) : (
          <BreadcrumbCurrent title={projectName}>{projectName}</BreadcrumbCurrent>
        )}
        {trail?.collection && (
          <button
            type="button"
            onClick={trail.collection.open}
            title={trail.collection.label}
            className={breadcrumbLinkClass}
          >
            {trail.collection.label}
          </button>
        )}
        {trail?.part ? (
          <button type="button" onClick={trail.part.close} className={breadcrumbLinkClass}>
            <MiniMessageInline source={trail.label} />
          </button>
        ) : (
          trail && (
            <BreadcrumbCurrent>
              {/* MiniMessage (a menu's title): its style, not its tags. */}
              <MiniMessageInline source={trail.label} />
            </BreadcrumbCurrent>
          )
        )}
        {trail?.part && (
          <BreadcrumbCurrent>
            <MiniMessageInline source={trail.part.label} />
          </BreadcrumbCurrent>
        )}
      </Breadcrumb>
    </span>
  );
}
