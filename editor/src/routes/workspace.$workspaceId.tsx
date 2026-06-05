import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserPack, getNetworkOfPack } from "@/lib/api/userPacks";
import { useSessionStore } from "@/state/sessionStore";

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: WorkspaceRedirect,
});

// Legacy redirect: old /workspace/$id URLs map to the new server-scoped URL.
// Works in both session mode (trust dance via /artisan editor) and user-auth.
function WorkspaceRedirect() {
  const { workspaceId } = useParams({ from: "/workspace/$workspaceId" });
  const { t } = useTranslation();
  const accessToken = useSessionStore((s) => s.accessToken);
  const sessionNetworkId = useSessionStore((s) => s.networkId);
  const sessionServerKeyId = useSessionStore((s) => s.serverKeyId);
  const [dest, setDest] = useState<{ networkId: string; serverId: string } | null>(null);

  useEffect(() => {
    // Session mode: trust dance via `/artisan editor` populates sessionStore
    // with serverKeyId + networkId — both are session-bound. No pack fetch
    // needed; redirect immediately to the server-scoped URL.
    if (accessToken && sessionNetworkId && sessionServerKeyId) {
      setDest({ networkId: sessionNetworkId, serverId: sessionServerKeyId });
      return;
    }
    // User-auth mode (cookie session): fetch the pack to discover its network + server.
    if (!accessToken) {
      loadUserPack(workspaceId)
        .then((res) => {
          if (res.networkId && res.serverKeyId) {
            setDest({ networkId: res.networkId, serverId: res.serverKeyId });
            return;
          }
          return getNetworkOfPack(workspaceId).then((networkId) => {
            if (networkId && res.serverKeyId) {
              setDest({ networkId, serverId: res.serverKeyId });
            }
          });
        })
        .catch(console.error);
    }
  }, [workspaceId, accessToken, sessionNetworkId, sessionServerKeyId]);

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
