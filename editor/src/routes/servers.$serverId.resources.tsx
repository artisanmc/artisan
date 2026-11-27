import { KitThemePage } from "@/features/assets/KitThemePage";
import { runExportThemeZip } from "@/features/export/runExportZip";
import { themeImporter } from "@/features/import/themeImporter";
import { ResourcePlaces } from "@/features/project/ResourcePlaces";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import { useServerIndexRereads } from "@/features/serverIndex/serverIndexRereads";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { renameProject } from "@/lib/api/projectIdentity";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { deleteUserProject } from "@/lib/api/userProjects";
import { THEMES_CONFIG_KEY, isThemeName, themeChange, themesRenamed } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/resources")({
  component: ServerResourcesTab,
  validateSearch: (search: Record<string, unknown>): { theme?: string } =>
    typeof search.theme === "string" && isThemeName(search.theme) ? { theme: search.theme } : {},
});

/**
 * The server's Resources tab (ADR `resources-one-screen`, decision 5): the places a resource
 * lives in on the left (`ResourcePlaces`: the server's themes, the base, its modules), the
 * place that is open on the right. Every place is a Project, which shows the same places
 * beside its Resources: without `?theme=<name>` (one theme's page: its preview and settings)
 * the tab leads to the base's.
 */
function ServerResourcesTab() {
  const { serverId, serverKeyId } = useServerFrame();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme } = Route.useSearch();
  // The server index reads the modules, the themes and the menus that name the images.
  // A theme created, renamed or deleted is read with the server's Projects again.
  const rereads = useServerIndexRereads((s) => s.count);
  useServerIndexLoader(serverId, serverKeyId !== null, rereads);
  const read = useKitStore((s) => s.read);
  const ownThemes = useKitStore((s) => s.own);
  const kitId = read?.projectId;
  // The base is the place the tab opens on, in its Project.
  useEffect(() => {
    if (theme || !kitId) return;
    void navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId: kitId },
      search: { tab: "resources" },
      replace: true,
    });
  }, [theme, kitId, serverId, navigate]);
  if (!serverKeyId) return null;
  const openModule = (projectId: string) =>
    navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId },
      search: { tab: "resources" },
    });
  const showTheme = (name?: string) =>
    navigate({
      to: "/servers/$serverId/resources",
      params: { serverId },
      search: name ? { theme: name } : {},
    });
  // The common images are shown in the server's themes from now on, and its pack rebuilt in them.
  const stackSaved = (saved: Record<string, unknown>) => {
    useKitStore.getState().readConfig(saved);
    rebuildServerPackInBackground(t, serverKeyId);
  };
  const putInPlace = async (name: string, put: boolean) => {
    const { themes, stacks } = useKitStore.getState();
    stackSaved(await patchServerConfig(serverKeyId, themeChange(themes, stacks, name, put)));
  };
  /**
   * Writes the themes in place once a theme's folder has moved (`names`; `null`: it was not in
   * place, nothing to write), then reads the server's themes again. The folder is moved first:
   * a refusal then leaves the list as it was.
   */
  const stackFollows = async (names: string[] | null) => {
    useServerIndexRereads.getState().bump();
    if (!names) return;
    let saved: Record<string, unknown>;
    try {
      saved = await patchServerConfig(serverKeyId, { [THEMES_CONFIG_KEY]: names });
    } catch {
      throw new Error("stack_failed");
    }
    stackSaved(saved);
  };
  const renameTheme = async (name: string, target: string) => {
    const mine = useKitStore.getState().own[name];
    if (!mine) throw new Error("unknown_project");
    const result = await renameProject(mine.projectId, {
      operationId: crypto.randomUUID(),
      targetId: target,
    });
    if (result.status !== "complete") throw new Error("failed");
    // The page of the theme under its new name, before the list is written: a refusal there is said on it.
    void showTheme(target);
    await stackFollows(themesRenamed(useKitStore.getState().themes, name, target));
  };
  const deleteTheme = async (name: string) => {
    const mine = useKitStore.getState().own[name];
    if (!mine) throw new Error("unknown_project");
    await deleteUserProject(mine.projectId);
    void showTheme();
    const { themes } = useKitStore.getState();
    await stackFollows(themes.includes(name) ? themes.filter((other) => other !== name) : null);
  };
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" data-testid="server-resources">
      <ResourcePlaces
        serverId={serverId}
        serverKeyId={serverKeyId}
        selected={theme ? { kind: "theme", name: theme } : null}
        importTheme={themeImporter}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          {theme ? (
            <KitThemePage
              name={theme}
              onOpenKit={kitId ? () => void openModule(kitId) : undefined}
              onOpenTheme={
                ownThemes[theme]
                  ? () => void openModule((ownThemes[theme] as { projectId: string }).projectId)
                  : undefined
              }
              onPutInPlace={putInPlace}
              onRename={renameTheme}
              onDelete={deleteTheme}
              onExport={async (name) => {
                const mine = useKitStore.getState().own[name];
                if (!mine) throw new Error("transport");
                const result = await runExportThemeZip(mine.projectId, name);
                if (!result.ok) throw new Error(result.error ?? "transport");
              }}
            />
          ) : (
            <p className="text-[13px] text-[var(--text-mut)]" data-testid="resources-pick">
              {t(read ? "places.opening" : "places.pick")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
