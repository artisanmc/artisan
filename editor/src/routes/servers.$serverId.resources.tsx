import { KitPage } from "@/features/assets/KitPage";
import { KitThemePage } from "@/features/assets/KitThemePage";
import { NewThemeDialog } from "@/features/assets/NewThemeDialog";
import { useAssetStore } from "@/features/assets/assetStore";
import { useResourcesView } from "@/features/assets/resourcesView";
import { saveThemeColors } from "@/features/assets/themeWrite";
import {
  SERVER_COMMON,
  ServerResources,
  type ServerResourcesScope,
  WHOLE_SERVER,
} from "@/features/project/ServerResources";
import { menusNamingCommon, useImageUses } from "@/features/project/imageUses";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { commonImageKey } from "@/lib/pack/kit";
import { isThemeName, themeChange } from "@/lib/pack/theme";
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
 * `?show=<module>` one module's, `?theme=<name>` a theme of the common images.
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
  if (theme)
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <KitThemePage
            name={theme}
            onBack={() => void showScope(SERVER_COMMON)}
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
            onPutInPlace={async (name, put) => {
              const { themes, stacks } = useKitStore.getState();
              const saved = await patchServerConfig(
                serverKeyId,
                themeChange(themes, stacks, name, put),
              );
              // The kit's images are shown in the server's themes from now on, and its pack rebuilt in them.
              useKitStore.getState().readConfig(saved);
              rebuildServerPackInBackground(t, serverKeyId);
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
      common={
        <KitPage
          onTheme={(name) => void showScope(SERVER_COMMON, name)}
          menusNaming={menusNamingCommon(uses)}
          usesOf={(name) => uses.get(commonImageKey(name))?.length ?? 0}
          onPiece={openCommon}
          onOpenKit={kitId ? () => void openModule(kitId) : undefined}
          newTheme={
            kitId
              ? (themes) => (
                  <NewThemeDialog
                    serverKeyId={serverKeyId}
                    taken={themes}
                    onCreated={(name) => {
                      setRereads((count) => count + 1);
                      void showScope(SERVER_COMMON, name);
                    }}
                  />
                )
              : undefined
          }
        />
      }
    />
  );
}
