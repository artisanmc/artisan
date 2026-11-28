import { IconTile } from "@/components/ui/icon-tile";
import type { Project } from "@/domain/types";
import { projectDestination } from "@/lib/projectNavigation";
import { projectUrlId } from "@/lib/projectUrlId";
import { useSidebarStore } from "@/state/sidebarStore";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";

const LOOK = { fg: "var(--text-mut)", soft: "var(--surface-raised-2)" } as const;

/**
 * The module's captured items in its tree, after its Documents and its data: one row that
 * opens their page (`?tab=items`). They are the module's content, named by its menus as
 * `item:<id>`, and never go in the players' pack: their place is here, not in Resources.
 * No row while the module has none: one is captured from the canvas's Buttons panel.
 */
export function CapturedItemsRow({ project }: { project: Project }) {
  const count = project.capturedItems?.length ?? 0;
  // Nothing to list: no row, and no router read (a tree also renders outside one).
  if (count === 0) return null;
  return <Row project={project} count={count} />;
}

function Row({ project, count }: { project: Project; count: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId, projectId, documentId, screenId, collectionDir, dataSourceId } = useParams({
    strict: false,
  }) as Record<string, string | undefined>;
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  // The open page is this module's root, on its items: the URL names it by its folder or its id.
  const here = projectId === project.id || projectId === projectUrlId(project);
  const current =
    here && tab === "items" && !documentId && !screenId && !collectionDir && !dataSourceId;
  return (
    <div
      className={`flex items-center rounded-[10px] ${current ? "" : "hover:bg-[var(--surface-hover)]"}`}
      style={current ? { background: LOOK.soft } : undefined}
      data-testid="captured-items-row"
    >
      <button
        type="button"
        onClick={() => {
          if (!serverId) return;
          useSidebarStore.getState().close();
          void navigate({ ...projectDestination(project, serverId), search: { tab: "items" } });
        }}
        aria-current={current ? "page" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-[5px] pr-2 pl-1.5 text-left text-[13px] leading-5 text-[var(--text)] ${
          current ? "font-semibold" : ""
        }`}
      >
        <span className="flex shrink-0" aria-hidden>
          <IconTile icon={Package} fg={LOOK.fg} soft={LOOK.soft} size="xs" />
        </span>
        <span className="flex-1 truncate">{t("project.tabs.items")}</span>
        <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{count}</span>
      </button>
    </div>
  );
}
