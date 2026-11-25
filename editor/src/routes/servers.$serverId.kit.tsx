import { documentsOf } from "@/domain/documents";
import { useResourcesView } from "@/features/assets/resourcesView";
import { KitPage } from "@/features/assets/KitPage";
import { KitThemePage } from "@/features/assets/KitThemePage";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { THEME_CONFIG_KEY, configuredTheme, isThemeName } from "@/lib/pack/theme";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { createProject } from "@/lib/api/servers";
import { KIT_FOLDER, KIT_PREFIX } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/kit")({
  component: ServerKitTab,
  validateSearch: (search: Record<string, unknown>): { theme?: string } =>
    typeof search.theme === "string" && isThemeName(search.theme) ? { theme: search.theme } : {},
});

/** The UI kit tab: the images the server's menus share, read from its published kit module. */
function ServerKitTab() {
  const { serverId, serverKeyId } = useServerFrame();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme } = Route.useSearch();
  // The server index reads the kit module and the menus that name it.
  useServerIndexLoader(serverId, serverKeyId !== null);
  const projects = useServerIndexStore((s) => s.projects);
  const kitId = useKitStore((s) => s.read?.projectId);
  const menusNaming = useMemo(
    () =>
      projects
        .flatMap((p) => documentsOf(p, "menu"))
        .filter((menu) => JSON.stringify(menu).includes(`"${KIT_PREFIX}`)).length,
    [projects],
  );
  if (!serverKeyId) return null;
  const openKit = (projectId: string) =>
    navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId },
      search: { tab: "resources" },
    });
  const showTheme = (name: string | undefined) =>
    navigate({
      to: "/servers/$serverId/kit",
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
          menusNaming={menusNaming}
          onPiece={async (id) => {
            // A server without a kit module gets it at its first redrawn piece.
            const target =
              kitId ??
              projects.find((p) => (p.diskId ?? p.id) === KIT_FOLDER)?.id ??
              (await createProject(serverKeyId, KIT_FOLDER)).id;
            useResourcesView.getState().askPiece(id);
            await openKit(target);
          }}
          onOpenKit={kitId ? () => void openKit(kitId) : undefined}
        />
      </div>
    </div>
  );
}
