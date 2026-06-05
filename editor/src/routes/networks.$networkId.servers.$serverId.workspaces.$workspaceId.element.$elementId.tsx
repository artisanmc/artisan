import { createFileRoute, useNavigate, useParams, Link, Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { ElementId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { usePackLoader } from "@/features/pack/usePackLoader";
import { ElementEditor } from "@/features/element-editor/ElementEditor";
import { WorkspaceTopBarControls } from "@/components/WorkspaceTopBarControls";

export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
)({
  component: ElementFocusPage,
});

function ElementFocusPage() {
  const { networkId, serverId, workspaceId, elementId } = useParams({
    from: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
  });
  const pId = workspaceId as PackId;
  const eId = elementId as ElementId;
  const token = useSessionStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.currentUser);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const packs = useAccountStore((s) => s.account.packs);
  const { pack: userPack } = usePackLoader(pId);
  const sessionPack = packs.find((p) => p.id === pId);
  const pack = token ? sessionPack : userPack;

  // Esc → back to canvas. Ignored while focus is inside an INPUT/TEXTAREA so
  // users can still cancel text edits without leaving the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      navigate({
        to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
        params: { networkId, serverId, workspaceId },
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, networkId, serverId, workspaceId]);

  // Auth gates: mirror the parent workspace route's null-return / redirect pattern.
  if (!token && !currentUser) return <Navigate to="/session" replace />;
  if (token && packs.length === 0 && !currentUser) return <Navigate to="/session" replace />;
  if (!pack) return null;

  const leftSlot = (
    <>
      <Link
        to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
        params={{ networkId, serverId, workspaceId }}
        className="btn btn-sm btn-ghost"
        aria-label={t("focusMode.backToCanvas")}
      >
        <ArrowLeft className="size-[14px]" />
        {t("focusMode.backToCanvas")}
      </Link>
      <span className="mx-2 h-4 w-px shrink-0 bg-[var(--border-soft)]" />
      <span className="truncate font-mono text-[13px] text-[var(--text)]">{elementId}</span>
    </>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspaceTopBarControls pack={pack} packId={pId} leftSlot={leftSlot} />
        <div className="min-h-0 flex-1">
          <ElementEditor pack={pack} elementId={eId} />
        </div>
      </main>
    </div>
  );
}

export default ElementFocusPage;
