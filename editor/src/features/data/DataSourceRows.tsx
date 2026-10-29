import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTile } from "@/components/ui/icon-tile";
import { listedDataSources } from "@/domain/projectData";
import type { DataSource, Project } from "@/domain/types";
import { dataSourceDestination } from "@/lib/projectNavigation";
import { projectUrlId } from "@/lib/projectUrlId";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Braces, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";

const DATA_LOOK = {
  fg: "var(--kind-data)",
  soft: "var(--kind-data-soft)",
} as const;

/**
 * A Project's own data in its tree, after its Documents: one row per table or config
 * sheet, opening its page (`…/data/$dataSourceId`). Sources a module's model types, or a
 * module's declared screen edits, are left out: that screen has its own row. `editable`
 * adds the `···` menu.
 */
export function DataSourceRows({ project, editable }: { project: Project; editable: boolean }) {
  const screens = useServerScreensStore((s) => s.screens);
  const sources = listedDataSources(project, screens);
  // Nothing to list: no row, and no router read (a tree also renders outside one).
  if (sources.length === 0) return null;
  return <DataSourceList project={project} sources={sources} editable={editable} />;
}

function DataSourceList({
  project,
  sources,
  editable,
}: {
  project: Project;
  sources: DataSource[];
  editable: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverId, projectId, dataSourceId } = useParams({ strict: false }) as {
    serverId?: string;
    projectId?: string;
    dataSourceId?: string;
  };
  // The open page is this Project's: the URL names it by its folder or its id.
  const here = projectId === project.id || projectId === projectUrlId(project);
  const open = (d: DataSource) => {
    if (!serverId) return;
    useSidebarStore.getState().close();
    void navigate(dataSourceDestination(project, serverId, String(d.id)));
  };
  return (
    <ul aria-label={t("dataSources.sidebarGroup")} className="flex flex-col pb-1.5 last:pb-0">
      {sources.map((d) => {
        const active = here && dataSourceId === String(d.id);
        return (
          <li key={d.id} data-testid={`data-source-row-${d.id}`}>
            <div
              className={`group flex items-center gap-0.5 rounded-[10px] ${active ? "" : "hover:bg-[var(--surface-hover)]"}`}
              style={active ? { background: DATA_LOOK.soft } : undefined}
            >
              <button
                type="button"
                onClick={() => open(d)}
                aria-current={active ? "page" : undefined}
                title={
                  d.shape === "table" ? t("dataSources.shapeTable") : t("dataSources.shapeConfig")
                }
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-[5px] pr-2 pl-1.5 text-left text-[13px] leading-5 text-[var(--text)] ${
                  active ? "font-semibold" : ""
                }`}
              >
                <span className="flex shrink-0" aria-hidden>
                  <IconTile
                    icon={d.shape === "table" ? Table2 : Braces}
                    fg={DATA_LOOK.fg}
                    soft={DATA_LOOK.soft}
                    size="xs"
                  />
                </span>
                <span className="flex-1 truncate">{d.name}</span>
              </button>
              {editable && (
                <DataSourceRowActions project={project} source={d} onOpen={() => open(d)} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DataSourceRowActions({
  project,
  source,
  onOpen,
}: {
  project: Project;
  source: DataSource;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex shrink-0 items-center justify-center px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text)] lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100"
        aria-label={t("projectPanel.options")}
      >
        ···
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onOpen}>{t("projectPanel.edit")}</DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            if (!window.confirm(t("dataSources.confirmRemove", { name: source.name }))) return;
            useProjectsStore
              .getState()
              .removeProjectDataSource({ projectId: project.id, id: source.id });
          }}
        >
          {t("projectPanel.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
