import { KitPage } from "@/features/assets/KitPage";
import { KitThemePage } from "@/features/assets/KitThemePage";
import { NewThemeDialog } from "@/features/assets/NewThemeDialog";
import { ThemesPage } from "@/features/assets/ThemesPage";
import { useAssetStore } from "@/features/assets/assetStore";
import { useResourcesView } from "@/features/assets/resourcesView";
import { saveThemeColors } from "@/features/assets/themeWrite";
import { runExportThemeZip } from "@/features/export/runExportZip";
import { ImportThemeDialog } from "@/features/import/ImportThemeDialog";
import {
  SERVER_COMMON,
  SERVER_THEMES,
  ServerResources,
  type ServerResourcesScope,
  WHOLE_SERVER,
} from "@/features/project/ServerResources";
import { menusNamingCommon, useImageUses } from "@/features/project/imageUses";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { renameProject } from "@/lib/api/projectIdentity";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { deleteUserProject } from "@/lib/api/userProjects";
import { commonImageKey } from "@/lib/pack/kit";
import { THEMES_CONFIG_KEY, isThemeName, themeChange, themesRenamed } from "@/lib/pack/theme";
import { projectDestination } from "@/lib/projectNavigation";
import { useKitStore } from "@/state/kitStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/resources")({
  component: ServerResourcesTab,
  validateSearch: (search: Record<string, unknown>): { theme?: string; show?: string } => ({
    ...(typeof search.theme === "string" && isThemeName(search.theme)
      ? { theme: search.theme }
      : {}),
    ...(typeof search.show === "string" && search.show && search.show !== WHOLE_SERVER
      ? { show: search.show }
      : {}),
  }),
});

/**
 * The server's Resources tab: every module's images and fonts and the common images, read as
 * published (`ServerResources`). `?show=common` is the page of the common images alone,
 * `?show=themes` the server's themes and their stack, `?show=<module>` one module's,
 * `?theme=<name>` one theme's page, which goes back to the page it was opened from.
 */
function ServerResourcesTab() {
  const { serverId, serverKeyId } = useServerFrame();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme, show } = Route.useSearch();
  // The server index reads the modules, the theme and the menus that name the images.
  // A theme created here is read with the server's Projects again.
  const [rereads, setRereads] = useState(0);
  useServerIndexLoader(serverId, serverKeyId !== null, rereads);
  const uses = useImageUses();
  const read = useKitStore((s) => s.read);
  const ownThemes = useKitStore((s) => s.own);
  const kitId = read?.projectId;
  if (!serverKeyId) return null;
  const openModule = (projectId: string) =>
    navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId },
      search: { tab: "resources" },
    });
  const showScope = (scope: ServerResourcesScope, name?: string) =>
    navigate({
      to: "/servers/$serverId/resources",
      params: { serverId },
      search: {
        ...(scope === WHOLE_SERVER ? {} : { show: scope }),
        ...(name ? { theme: name } : {}),
      },
    });
  const openCommon = kitId
    ? (name: string) => {
        useResourcesView.getState().askPiece(name);
        void openModule(kitId);
      }
    : undefined;
  const fromThemes = show === SERVER_THEMES;
  // The kit's images are shown in the server's themes from now on, and its pack rebuilt in them.
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
    setRereads((count) => count + 1);
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
    void showScope(fromThemes ? SERVER_THEMES : SERVER_COMMON, target);
    await stackFollows(themesRenamed(useKitStore.getState().themes, name, target));
  };
  const deleteTheme = async (name: string) => {
    const mine = useKitStore.getState().own[name];
    if (!mine) throw new Error("unknown_project");
    await deleteUserProject(mine.projectId);
    void showScope(SERVER_THEMES);
    const { themes } = useKitStore.getState();
    await stackFollows(themes.includes(name) ? themes.filter((other) => other !== name) : null);
  };
  // A theme created or imported here is read with the server's Projects again, then shown.
  const themeArrived = (from: ServerResourcesScope) => (name: string) => {
    setRereads((count) => count + 1);
    void showScope(from, name);
  };
  const newTheme = (from: ServerResourcesScope) =>
    kitId
      ? (themes: readonly string[]) => (
          <NewThemeDialog serverKeyId={serverKeyId} taken={themes} onCreated={themeArrived(from)} />
        )
      : undefined;
  /** What the Themes screen offers to add a theme: one from an archive, or an empty one. */
  const addTheme = kitId
    ? (themes: readonly string[]) => (
        <div className="flex flex-wrap gap-2">
          <ImportThemeDialog
            serverKeyId={serverKeyId}
            taken={themes}
            onImported={themeArrived(SERVER_THEMES)}
          />
          {newTheme(SERVER_THEMES)?.(themes)}
        </div>
      )
    : undefined;
  if (theme)
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <KitThemePage
            name={theme}
            onBack={() => void showScope(fromThemes ? SERVER_THEMES : SERVER_COMMON)}
            backLabel={fromThemes ? t("kit.theme.backToThemes") : undefined}
            onOpenKit={kitId ? () => void openModule(kitId) : undefined}
            onOpenTheme={
              ownThemes[theme]
                ? () => void openModule((ownThemes[theme] as { projectId: string }).projectId)
                : undefined
            }
            onColors={async (name, colors) => {
              const mine = useKitStore.getState().own[name];
              if (!mine) throw new Error("unknown_project");
              if (!(await saveThemeColors(mine, colors))) return;
              // The theme is read again as the server holds it, and its pack rebuilt when it is in place.
              setRereads((count) => count + 1);
              if (useKitStore.getState().themes.includes(name))
                rebuildServerPackInBackground(t, serverKeyId);
            }}
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
        </div>
      </div>
    );
  return (
    <ServerResources
      scope={show ?? WHOLE_SERVER}
      onScope={(scope) => void showScope(scope)}
      onOpenModule={(projectId, assetId) => {
        // The module's Resources open on this image once its files are read.
        useAssetStore.getState().setSelectedId(assetId);
        void openModule(projectId);
      }}
      onOpenCommon={openCommon}
      onOpenMenu={(projectId, menuId) =>
        void navigate(projectDestination(projectId, serverId, menuId, "menu"))
      }
      themes={
        <ThemesPage
          onTheme={(name) => void showScope(SERVER_THEMES, name)}
          onOrder={async (names) =>
            stackSaved(await patchServerConfig(serverKeyId, { [THEMES_CONFIG_KEY]: names }))
          }
          onPutInPlace={putInPlace}
          newTheme={addTheme}
        />
      }
      common={
        <KitPage
          onTheme={(name) => void showScope(SERVER_COMMON, name)}
          onThemes={() => void showScope(SERVER_THEMES)}
          menusNaming={menusNamingCommon(uses)}
          usesOf={(name) => uses.get(commonImageKey(name))?.filter((use) => !use.by).length ?? 0}
          onPiece={openCommon}
          onOpenKit={kitId ? () => void openModule(kitId) : undefined}
          newTheme={newTheme(SERVER_COMMON)}
        />
      }
    />
  );
}
