import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cx";
import { useSidebarStore } from "@/state/sidebarStore";
import { useTranslation } from "react-i18next";

/**
 * Waiting for a Project, shaped like what will be shown.
 *
 * The content is read from ITS server's disk: there is necessarily a delay,
 * and denying it with a blank page makes it look like an outage. A skeleton
 * matching the real layout holds the layout during that delay, so the data
 * arriving does not make the screen jump. It mirrors `ProjectCanvasPage`: the
 * topbar card (`ProjectTopBarControls`), then the board filling the framed
 * region, with its floating chrome — catalogue toggle top right, mode toolbar
 * bottom centre, minimap bottom right. The project's Documents live in the
 * app's left bar, which stays rendered: no tree column here.
 *
 * The label stays: a skeleton says "soon", it does not say WHAT is awaited
 * or where it comes from.
 */
export function ProjectLoadingSkeleton() {
  const { t } = useTranslation();
  const navigationPinned = useSidebarStore((s) => s.pinned);
  return (
    <div
      className="flex h-full min-h-0 flex-col pb-14 lg:pb-0"
      data-testid="project-skeleton"
      aria-busy
    >
      {/* Topbar: breadcrumb, view nav, editing tools, save/deploy on the right. */}
      <div
        className={cn("shrink-0 py-2 pl-2 pr-2 lg:pl-24 lg:pr-3", navigationPinned && "lg:pl-3")}
      >
        <div className="flex min-h-12 items-center gap-2 rounded-[var(--r-lg)] bg-[var(--surface)] px-2 py-1 lg:gap-3">
          <Skeleton className="ml-11 h-5 w-32 lg:ml-0" />
          <Skeleton className="hidden h-10 w-[204px] rounded-[var(--r-md)] lg:block" />
          <div className="flex-1" />
          <div className="hidden items-center gap-1 lg:flex">
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
            <Skeleton className="h-[34px] w-14 rounded-[10px]" />
          </div>
          <Skeleton className="size-8" />
          <Skeleton className="h-8 w-24 rounded-[var(--r-md)]" />
          <Skeleton className="size-8" />
        </div>
      </div>

      {/* Board: same frame as the loaded workspace (concave top-left corner). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
        <div className="stage-bg-dots relative h-full w-full">
          <div aria-hidden className="stage-bg-glow pointer-events-none absolute inset-0" />
          <Skeleton className="absolute top-3 right-3 h-10 w-28 rounded-[var(--r-md)]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[13px] text-[var(--text-mut)]">{t("project.loading")}</p>
          </div>
          <Skeleton className="-translate-x-1/2 absolute bottom-4 left-1/2 h-10 w-72 rounded-[12px]" />
          <Skeleton className="absolute right-2 bottom-2 h-[60px] w-[96px] rounded-md sm:h-[92px] sm:w-[148px]" />
        </div>
      </div>
    </div>
  );
}
