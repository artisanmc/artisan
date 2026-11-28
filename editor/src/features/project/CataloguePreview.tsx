import { IconTile } from "@/components/ui/icon-tile";
import type { Project } from "@/domain/types";
import { MenuPlayPreview } from "@/features/play/MenuPlayPreview";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useRef, useState } from "react";

/**
 * The picture of a catalogue card in grid mode: a menu as the game draws it (the Play engine,
 * drawn once the card is on screen: a long catalogue does not build every menu at once), any
 * other kind as its tile. Not interactive: the card around it opens the Document.
 */
export function CataloguePreview({
  project,
  kind,
  id,
  serverId,
}: {
  project: Project;
  kind: string;
  id: string;
  serverId: string | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const projects = useProjectsStore((s) => s.openProjects.projects);
  const live = kind === "menu" && !!serverId;
  useEffect(() => {
    const el = ref.current;
    if (!live || !el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          watch.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [live, seen]);

  const look = kindAppearance(kind);
  return (
    <div
      ref={ref}
      data-testid="catalogue-preview"
      className="pointer-events-none relative aspect-video w-full overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-inset)]"
    >
      {live && seen && serverId ? (
        <MenuPlayPreview
          serverId={serverId}
          projects={projects}
          projectId={project.id}
          menuId={id}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="lg" />
        </div>
      )}
    </div>
  );
}
