import { KitPage } from "@/features/assets/KitPage";
import { KitThemePage } from "@/features/assets/KitThemePage";
import { useAssetStore } from "@/features/assets/assetStore";
import { useResourcesView } from "@/features/assets/resourcesView";
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
import { THEME_CONFIG_KEY, configuredTheme, isThemeName } from "@/lib/pack/theme";
import { projectDestination } from "@/lib/projectNavigation";
import { useKitStore } from "@/state/kitStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  useServerIndexLoader(serverId, serverKeyId !== null);
  const uses = useImageUses();
  const read = useKitStore((s) => s.read);
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
            onPutInPlace={async (name) => {
              const saved = await patchServerConfig(serverKeyId, {
                [THEME_CONFIG_KEY]: name ?? "",
              });
              // The kit's images are shown in the server's theme from now on, and its pack rebuilt in it.
              useKitStore.getState().setTheme(configuredTheme(saved));
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
        />
      }
    />
  );
}
