import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function UnknownElementFallback() {
  const { t } = useTranslation();
  const urlParams = useParams({ strict: false }) as {
    workspaceId?: string;
    networkId?: string;
    serverId?: string;
  };
  const { workspaceId = "", networkId, serverId } = urlParams;

  const linkTo =
    networkId && serverId
      ? "/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
      : "/workspace/$workspaceId";
  const linkParams =
    networkId && serverId
      ? { networkId, serverId, workspaceId }
      : { workspaceId };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[15px] text-[var(--text)]">{t("focusMode.unknownElement")}</p>
      <Link
        to={linkTo as any}
        params={linkParams as any}
        className="btn btn-sm btn-primary"
      >
        {t("focusMode.backToCanvas")}
      </Link>
    </div>
  );
}
