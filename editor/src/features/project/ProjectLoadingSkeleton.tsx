import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

/**
 * Waiting for a Project, shaped like what will be shown.
 *
 * The content is read from ITS server's disk: there is necessarily a delay,
 * and denying it with a blank page makes it look like an outage. A skeleton
 * matching the real layout — top bar, tree on the left, canvas — holds the
 * layout during that delay, so the data arriving does not make the screen
 * jump.
 *
 * The label stays: a skeleton says "soon", it does not say WHAT is awaited
 * or where it comes from.
 */
export function ProjectLoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project-skeleton">
      {/* Top bar: brand, view nav, actions on the right. */}
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-2.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-56" />
        <div className="flex-1" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Document tree. */}
        <div className="hidden w-[240px] shrink-0 flex-col gap-2 border-r border-[var(--border-soft)] p-3 lg:flex">
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>

        {/* Canvas. */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
          <Skeleton className="h-[280px] w-full max-w-[520px]" />
          <p className="text-[13px] text-[var(--text-mut)]">{t("project.loading")}</p>
        </div>
      </div>
    </div>
  );
}
