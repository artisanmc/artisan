import { ServerModulesTab } from "@/features/serverModules/ServerModulesTab";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/updates")({
  component: ServerUpdatesTab,
});

/** The updates tab: Artisan and its modules from the site, for the account the network is linked to. */
function ServerUpdatesTab() {
  const { serverKeyId, summary } = useServerFrame();
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {summary?.updateRequired ? (
          <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.updateRequired")}</p>
        ) : (
          serverKeyId && <ServerModulesTab serverId={serverKeyId} />
        )}
      </div>
    </div>
  );
}
