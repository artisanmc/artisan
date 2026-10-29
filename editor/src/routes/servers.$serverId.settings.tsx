import { ServerConfigSection } from "@/features/serverConfig/ServerConfigSection";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useServerProjectList } from "./servers.$serverId";

export const Route = createFileRoute("/servers/$serverId/settings")({
  component: ServerSettingsTab,
});

/** The settings tab: the server's `config.yml`, as its plugin reports it. */
function ServerSettingsTab() {
  const { serverKeyId, summary } = useServerFrame();
  const { t } = useTranslation();
  // The container textures are picked among the projects' images.
  const { projects } = useServerProjectList(serverKeyId);
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6">
        <p className="text-[12px] text-[var(--text-mut)]">{t("serverConfig.connectionHint")}</p>
        {summary?.updateRequired ? (
          <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.updateRequired")}</p>
        ) : (
          serverKeyId && <ServerConfigSection serverKeyId={serverKeyId} projects={projects} />
        )}
      </div>
    </div>
  );
}
