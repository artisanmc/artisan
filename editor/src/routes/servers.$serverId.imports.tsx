import { ServerImportsTab } from "@/features/serverImports/ServerImportsTab";
import { useServerFrame } from "@/features/serverPage/serverFrame";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/imports")({
  component: ServerImportsRoute,
});

/** The imports tab: another plugin's data brought into the server's modules, behind `artisan.editor.config`. */
function ServerImportsRoute() {
  const { serverKeyId, summary } = useServerFrame();
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {summary?.updateRequired ? (
          <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.updateRequired")}</p>
        ) : (
          serverKeyId && <ServerImportsTab serverId={serverKeyId} />
        )}
      </div>
    </div>
  );
}
