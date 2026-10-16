import type { Project } from "@/domain/types";
import { ProjectLoadingSkeleton } from "@/features/project/ProjectLoadingSkeleton";
import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { projectLoadStatus } from "./projectLoadState";

/**
 * What the workspace shows before it can show the Project: auth hydration, the
 * login redirect, a load failure, the read in flight. `children` renders only
 * once the Project is there.
 */
export function WorkspaceGate({
  authLoading,
  principalId,
  project,
  error,
  offline,
  fromDraft,
  children,
}: {
  authLoading: boolean;
  principalId: string | null | undefined;
  project: Project | null;
  error: string | null;
  offline: boolean;
  fromDraft: boolean;
  children: (project: Project) => ReactNode;
}) {
  const { t } = useTranslation();
  // Wait for auth hydration first — on a hard load, `/me` is still in flight
  // and currentUser is briefly null; gating now would bounce a logged-in user
  // to /login. Mirrors admin.tsx's hydration-aware gate.
  if (authLoading) return null;
  if (!principalId)
    return (
      <Navigate
        to="/login"
        replace
        search={{ next: window.location.pathname + window.location.search }}
      />
    );
  const status = projectLoadStatus({ project, error, fromDraft });
  // Every load failure must show. The Project's content lives on ITS server's
  // disk and nowhere else (ADR `server-disk-only-storage`), so there is nothing
  // to display, and certainly not a stale copy. Handling only the offline case
  // let the others (unknown project, read refused, transport) fall through to a
  // blank page that looks like an endless load.
  // Server unreachable but a draft is open: editing goes on, nothing blocks.
  // The state is dated and announced (server badge), not presented as the
  // truth.
  if (status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[15px] text-[var(--text)]">
          {offline
            ? t("project.offlineTitle")
            : error === "plugin_update_required"
              ? t("project.updateRequiredTitle")
              : t("project.loadFailedTitle")}
        </p>
        <p className="max-w-md text-[13px] text-[var(--text-mut)]">
          {offline
            ? t("project.offlineBody")
            : error === "plugin_update_required"
              ? t("project.updateRequiredBody")
              : t("project.loadFailedBody")}
        </p>
        <code className="text-[11px] text-[var(--text-faint)]">{error}</code>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          {t("project.offlineRetry")}
        </button>
      </div>
    );
  }
  // The read is in flight. It goes through the hub THEN the plugin, down to the
  // server's disk, and can take several seconds. Rendering nothing gave a blank
  // page that looks like an outage: say what is awaited, and from where.
  if (status === "loading" || !project) return <ProjectLoadingSkeleton />;
  return <>{children(project)}</>;
}
