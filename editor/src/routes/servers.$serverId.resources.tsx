import { useResourcesView } from "@/features/assets/resourcesView";
import { themeImporter } from "@/features/import/themeImporter";
import { ResourcePlaces } from "@/features/project/ResourcePlaces";
import { ThemeOverview } from "@/features/project/ThemeOverview";
import { useServerIndexRereads } from "@/features/serverIndex/serverIndexRereads";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { isThemeName } from "@/lib/pack/theme";
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
 * beside its Resources: the tab leads to the base's, and `?theme=<name>` to that theme's,
 * open on its overview. A theme the common images still keep has its overview here alone.
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
  const kitId = read?.projectId;
  // A theme of its own folder has one page, its Project's Resources, which opens on its
  // overview: the base without a theme named, the same way.
  const ownProject = useKitStore((s) => (theme ? s.own[theme]?.projectId : undefined));
  const target = theme ? ownProject : kitId;
  useEffect(() => {
    if (!target) return;
    if (theme) useResourcesView.getState().setView("theme");
    void navigate({
      to: "/servers/$serverId/projects/$projectId",
      params: { serverId, projectId: target },
      search: { tab: "resources" },
      replace: true,
    });
  }, [theme, target, serverId, navigate]);
  if (!serverKeyId) return null;
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
            <ThemeOverview name={theme} serverId={serverId} serverKeyId={serverKeyId} />
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
