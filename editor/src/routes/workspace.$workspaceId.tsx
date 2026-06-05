import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserPack } from "@/lib/api/userPacks";

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: WorkspaceRedirect,
});

function WorkspaceRedirect() {
  const { workspaceId } = useParams({ from: "/workspace/$workspaceId" });
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
      to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
      params={{
        networkId: dest.networkId,
        serverId: dest.serverId,
        workspaceId,
      }}
      replace
    />
  );
}

export default WorkspaceRedirect;
