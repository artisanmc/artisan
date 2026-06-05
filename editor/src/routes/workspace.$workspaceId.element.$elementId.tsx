import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserPack } from "@/lib/api/userPacks";

export const Route = createFileRoute("/workspace/$workspaceId/element/$elementId")({
  component: ElementFocusRedirect,
});

function ElementFocusRedirect() {
  const { workspaceId, elementId } = useParams({
    from: "/workspace/$workspaceId/element/$elementId",
  });
  const { t } = useTranslation();
  const [dest, setDest] = useState<{
    networkId: string;
    serverId: string;
  } | null>(null);

  useEffect(() => {
    loadUserPack(workspaceId)
      .then((res) => {
        if (res.networkId && res.serverKeyId) {
          setDest({ networkId: res.networkId, serverId: res.serverKeyId });
        }
      })
      .catch(console.error);
  }, [workspaceId]);

  if (!dest) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-mut)] text-[13px]">
        {t("redirect.redirecting", "Redirecting…")}
      </div>
    );
  }

  return (
    <Navigate
      to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId"
      params={{
        networkId: dest.networkId,
        serverId: dest.serverId,
        workspaceId,
        elementId,
      }}
      replace
    />
  );
}

export default ElementFocusRedirect;
