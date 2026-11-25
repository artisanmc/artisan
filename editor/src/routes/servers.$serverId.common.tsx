import { KitPage } from "@/features/assets/KitPage";
import { KitThemePage } from "@/features/assets/KitThemePage";
import { useResourcesView } from "@/features/assets/resourcesView";
import { menusNamingCommon, useCommonImageUses } from "@/features/project/commonImageUses";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { THEME_CONFIG_KEY, configuredTheme, isThemeName } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/common")({
  component: ServerKitTab,
  validateSearch: (search: Record<string, unknown>): { theme?: string } =>
    typeof search.theme === "string" && isThemeName(search.theme) ? { theme: search.theme } : {},
});

/** The common images tab: the images the server's menus share, read from the published theme `artisan`. */
function ServerKitTab() {
  const { serverId, serverKeyId } = useServerFrame();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme } = Route.useSearch();
  // The server index reads the theme and the menus that name its images.
  useServerIndexLoader(serverId, serverKeyId !== null);
  const read = useKitStore((s) => s.read);
  const kitId = read?.projectId;
  const uses = useCommonImageUses();
  if (!serverKeyId) return null;
  const openKit = (projectId: string) =>
    navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId },
      search: { tab: "resources" },
    });
  const showTheme = (name: string | undefined) =>
    navigate({
      to: "/servers/$serverId/common",
      params: { serverId },
      search: name ? { theme: name } : {},
    });
  if (theme)
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <KitThemePage
            name={theme}
            onBack={() => void showTheme(undefined)}
            onOpenKit={kitId ? () => void openKit(kitId) : undefined}
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
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <KitPage
          onTheme={(name) => void showTheme(name)}
          menusNaming={menusNamingCommon(uses)}
          usesOf={(name) => uses.get(name)?.length ?? 0}
          onPiece={
            kitId
              ? (id) => {
                  useResourcesView.getState().askPiece(id);
                  void openKit(kitId);
                }
              : undefined
          }
          onOpenKit={kitId ? () => void openKit(kitId) : undefined}
        />
      </div>
    </div>
  );
}
