import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserPack, getNetworkOfPack } from "@/lib/api/userPacks";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: WorkspaceRedirect,
});

// Legacy redirect: old /workspace/$id URLs map to the new server-scoped URL.
// Works in both session mode (trust dance via /artisan editor) and user-auth.
function WorkspaceRedirect() {
  const { workspaceId } = useParams({ from: "/workspace/$workspaceId" });
  const { t } = useTranslation();
  const sessionPack = useAccountStore((s) =>
    s.account.packs.find((p) => p.id === workspaceId),
  );
  const sessionNetworkId = useSessionStore((s) => s.networkId);
  const [dest, setDest] = useState<{ networkId: string; serverId: string } | null>(null);

  useEffect(() => {
    // 1) Session mode: pack is in accountStore, network on the session.
    if (sessionPack?.serverKeyId && sessionNetworkId) {
      setDest({ networkId: sessionNetworkId, serverId: sessionPack.serverKeyId });
      return;
    }
    // 2) User-auth mode: fetch the pack's network + server via cookie-auth API.
    loadUserPack(workspaceId)
      .then((res) => {
        if (res.networkId && res.serverKeyId) {
          setDest({ networkId: res.networkId, serverId: res.serverKeyId });
          return;
        }
        // 3) Last resort: ask getNetworkOfPack (older endpoint that some routes still use).
        return getNetworkOfPack(workspaceId).then((networkId) => {
          if (networkId && res.serverKeyId) {
            setDest({ networkId, serverId: res.serverKeyId });
          }
        });
      })
      .catch(console.error);
  }, [workspaceId, sessionPack?.serverKeyId, sessionNetworkId]);

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
