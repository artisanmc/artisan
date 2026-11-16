import { commandNames, menuRefs } from "@/domain/statsContent";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { StatsPage } from "@/features/stats/StatsPage";
import { type StatsSearch, validateStatsSearch } from "@/features/stats/period";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

export const Route = createFileRoute("/servers/$serverId/stats")({
  component: ServerStatsTab,
  validateSearch: validateStatsSearch,
});

/** The statistics tab: what the server's content does, behind `artisan.editor.stats`. */
function ServerStatsTab() {
  const { serverId, serverKeyId } = useServerFrame();
  const search = Route.useSearch();
  const navigate = useNavigate();
  // The published projects name the menus and commands nobody used: statistics only know what happened.
  useServerIndexLoader(serverId, serverKeyId !== null);
  const projects = useServerIndexStore((s) => s.projects);
  const known = useMemo(
    () => ({ commands: commandNames(projects), menus: menuRefs(projects) }),
    [projects],
  );
  if (!serverKeyId) return null;
  return (
    <StatsPage
      serverId={serverKeyId}
      search={search}
      known={known}
      onSearch={(patch: Partial<StatsSearch>) =>
        navigate({
          to: "/servers/$serverId/stats",
          params: { serverId },
          search: (previous) => ({ ...previous, ...patch }),
          replace: true,
        })
      }
    />
  );
}
