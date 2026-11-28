import { KitThemePage } from "@/features/assets/KitThemePage";
import { runExportThemeZip } from "@/features/export/runExportZip";
import { useServerIndexRereads } from "@/features/serverIndex/serverIndexRereads";
import { renameProject } from "@/lib/api/projectIdentity";
import { patchServerConfig } from "@/lib/api/serverConfig";
import { deleteUserProject } from "@/lib/api/userProjects";
import { THEMES_CONFIG_KEY, themeChange, themesRenamed } from "@/lib/pack/theme";
import { useKitStore } from "@/state/kitStore";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { rebuildServerPackInBackground } from "./resourcePackSync";

/**
 * A theme's overview: what it redraws, its colours, the sheet of the base's images without it
 * and with it, and what is done to it (put in place, rename, export, delete). The first view of
 * a theme's Resources, beside its files and its components: one page per theme. A theme the
 * common images still keep has this page alone (`/resources?theme=`).
 */
export function ThemeOverview({
  name,
  serverId,
  serverKeyId,
}: {
  name: string;
  /** The server as links carry it. */
  serverId: string;
  /** The server's key id, which its configuration is written under. */
  serverKeyId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const read = useKitStore((s) => s.read);
  const kitId = read?.projectId;
  const showTheme = (target?: string) =>
    navigate({
      to: "/servers/$serverId/resources",
      params: { serverId },
      search: target ? { theme: target } : {},
    });
  // The common images are shown in the server's themes from now on, and its pack rebuilt in them.
  const stackSaved = (saved: Record<string, unknown>) => {
    useKitStore.getState().readConfig(saved);
    rebuildServerPackInBackground(t, serverKeyId);
  };
  const putInPlace = async (theme: string, put: boolean) => {
    const { themes, stacks } = useKitStore.getState();
    stackSaved(await patchServerConfig(serverKeyId, themeChange(themes, stacks, theme, put)));
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
  const renameTheme = async (theme: string, target: string) => {
    const mine = useKitStore.getState().own[theme];
    if (!mine) throw new Error("unknown_project");
    const result = await renameProject(mine.projectId, {
      operationId: crypto.randomUUID(),
      targetId: target,
    });
    if (result.status !== "complete") throw new Error("failed");
    // The page of the theme under its new name, before the list is written: a refusal there is said on it.
    void showTheme(target);
    await stackFollows(themesRenamed(useKitStore.getState().themes, theme, target));
  };
  const deleteTheme = async (theme: string) => {
    const mine = useKitStore.getState().own[theme];
    if (!mine) throw new Error("unknown_project");
    await deleteUserProject(mine.projectId);
    void showTheme();
    const { themes } = useKitStore.getState();
    await stackFollows(themes.includes(theme) ? themes.filter((other) => other !== theme) : null);
  };
  return (
    <KitThemePage
      name={name}
      onOpenKit={
        kitId
          ? () =>
              void navigate({
                to: "/servers/$serverId/projects/$projectId",
                params: { serverId, projectId: kitId },
                search: { tab: "resources" },
              })
          : undefined
      }
      onPutInPlace={putInPlace}
      onRename={renameTheme}
      onDelete={deleteTheme}
      onExport={async (theme) => {
        const mine = useKitStore.getState().own[theme];
        if (!mine) throw new Error("transport");
        const result = await runExportThemeZip(mine.projectId, theme);
        if (!result.ok) throw new Error(result.error ?? "transport");
      }}
    />
  );
}
