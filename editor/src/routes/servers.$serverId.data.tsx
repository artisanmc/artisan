import { ServerSourcesPanel } from "@/features/data/ServerSourcesPanel";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/data")({
  component: ServerDataTab,
});

/** The data tab: the data sources the server's modules declare, at full height. */
function ServerDataTab() {
  const { serverKeyId, summary } = useServerFrame();
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-3 px-6 py-6">
      <p className="text-[12px] text-[var(--text-mut)]">{t("dataSources.serverSectionHint")}</p>
      {summary?.updateRequired ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.updateRequired")}</p>
      ) : (
        serverKeyId && <ServerSourcesPanel serverKeyId={serverKeyId} />
      )}
    </div>
  );
}
