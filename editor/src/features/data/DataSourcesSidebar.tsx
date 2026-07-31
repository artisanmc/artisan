import type { DataSource, DataSourceId, Project } from "@/domain/types";
import { resolveScreen } from "@/features/screens/screenList";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { urlNetworkId, urlServerId } from "@/lib/urlIds";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ServerSourcesSection } from "./ServerSourcesSection";

interface DataSourcesSidebarProps {
  project: Project;
  selectedId: DataSourceId | null;
  onSelect: (id: DataSourceId | null) => void;
  selectedServerRef: string | null;
  onSelectServerRef: (ref: string) => void;
}

export function DataSourcesSidebar({
  project,
  selectedId,
  onSelect,
  selectedServerRef,
  onSelectServerRef,
}: DataSourcesSidebarProps) {
  const { t } = useTranslation();
  const addProjectDataSource = useAccountStore((s) => s.addProjectDataSource);
  const declaredScreens = useServerScreensStore((s) => s.screens);
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const networks = useNetworksStore((s) => s.networks);
  const servers = useServersStore((s) => s.servers);
  const localProjects = useAccountStore((s) => s.account.projects);

  // Une source à model module-déclaré s'édite dans l'écran du module, pas ici
  // (ADR module-config-screens) — quelle que soit sa forme : une Config typée
  // par une déclaration (shop_settings) n'est pas plus modifiable ici qu'une
  // Table (categories).
  const isModuleManaged = (d: DataSource) => {
    const modelId = d.modelId;
    const model = modelId ? (project.dataModels ?? []).find((m) => m.id === modelId) : undefined;
    return model?.provenance === "module" ? model.id.split(":")[0] : null;
  };
  const ownSources = (project.dataSources ?? []).filter((d) => !isModuleManaged(d));
  const managedSources = (project.dataSources ?? []).filter((d) => isModuleManaged(d));

  return (
    <div className="flex flex-1 flex-col gap-4 p-3">
      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
          {t("dataSources.sectionProject")}
        </div>
        <ul className="flex flex-col gap-1">
          {ownSources.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onSelect(d.id)}
                className={
                  selectedId === d.id
                    ? "flex w-full items-center gap-1 rounded bg-[var(--surface-raised-2)] px-2 py-1 text-left text-[12px]"
                    : "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-[var(--text-mut)] hover:bg-[var(--surface-raised)]"
                }
              >
                <span>{d.shape === "table" ? "🗂" : "📦"}</span>
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-[9px] text-[var(--text-faint)]">
                  {d.shape === "table"
                    ? t("dataSources.shapeTable")
                    : t("dataSources.shapeConfig")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {managedSources.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1" data-testid="module-managed-sources">
            {managedSources.map((d) => {
              const moduleId = isModuleManaged(d);
              if (!moduleId) return null;
              const declared = declaredScreens.find(
                (s) => s.projectId === project.id && s.table === `data/${d.id}`,
              );
              const target =
                declared ?? resolveScreen(`${moduleId}:__auto__${project.id}__${d.id}`, [], localProjects);
              return (
                <li
                  key={d.id}
                  className="rounded border border-dashed border-[var(--border)] px-2 py-1.5 text-[11px] text-[var(--text-faint)]"
                >
                  <div className="flex items-center gap-1">
                    <span>🔒</span>
                    <span className="truncate">{d.name}</span>
                  </div>
                  <div className="mt-0.5">
                    {t("screens.managedByModule", { module: moduleId })}
                    {networkId && serverId && target && (
                      <>
                        {" — "}
                        <Link
                          to="/networks/$networkId/servers/$serverId/screens/$screenId"
                          params={{ networkId: urlNetworkId(networks, networkId)!, serverId: urlServerId(servers, networkId, serverId)!, screenId: target.id }}
                          className="underline hover:text-[var(--text)]"
                        >
                          {t("screens.openScreen")}
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={() => addProjectDataSource({ projectId: project.id, shape: "table" })}
            className="flex-1 rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("dataSources.addTable")}
          </button>
          <button
            type="button"
            onClick={() => addProjectDataSource({ projectId: project.id, shape: "config" })}
            className="flex-1 rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            {t("dataSources.addConfig")}
          </button>
        </div>
      </section>

      <ServerSourcesSection selectedRef={selectedServerRef} onSelect={onSelectServerRef} />
    </div>
  );
}
