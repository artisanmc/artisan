import { ProjectCanvasPage } from "@/features/project/ProjectWorkspace";
import { runExportDraftZip } from "@/features/export/runExportZip";
import { DemoApiError } from "@/lib/api/demo";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { bootstrapDemo, confirmDemoDraft } from "./demoLifecycle";

export function DemoEntry() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void bootstrapDemo(true)
      .then((session) => {
        if (cancelled || !session) return;
        useDemoStore.getState().setSession(session);
        void navigate({
          to: "/demo/projects/$projectId",
          params: { projectId: "demo" },
          replace: true,
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <output className="flex h-full items-center justify-center p-6">
      {error ? (
        <div>
          <p>{t("demo.unavailable")}</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            {t("demo.retry")}
          </button>
        </div>
      ) : (
        t("demo.loading")
      )}
    </output>
  );
}

export function DemoWorkspace() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { t } = useTranslation();
  const session = useDemoStore((s) => s.session);
  const expired = useDemoStore((s) => s.expired);
  const loadingAuth = useAuthStore((s) => s.isLoading);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const matchesSession = !!session && (projectId === "demo" || session.projectId === projectId);
  useEffect(() => {
    useDemoStore.getState().setActive(true);
    return () => useDemoStore.getState().setActive(false);
  }, []);
  useEffect(() => {
    if (matchesSession) return;
    let cancelled = false;
    void bootstrapDemo(false)
      .then((value) => {
        if (cancelled) return;
        if (!value || (projectId !== "demo" && value.projectId !== projectId)) {
          setError(true);
          return;
        }
        useDemoStore.getState().setSession(value);
      })
      .catch((cause) => {
        if (!cancelled) {
          if (cause instanceof DemoApiError && cause.status === 410)
            useDemoStore.getState().expire();
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, matchesSession]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(
      () => useDemoStore.getState().expire(),
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session]);
  // La démo est jetable : on la garde en l'exportant (ADR `server-only-projects`).
  const exportDemo = async () => {
    setBusy(true);
    try {
      const confirmed = await confirmDemoDraft();
      const project = useAccountStore
        .getState()
        .account.projects.find((p) => p.id === confirmed.projectId);
      const res = project ? await runExportDraftZip(project) : { ok: false };
      if (res.ok) toast.success(t("demo.exported"));
      else toast.error(t("demo.exportFailed"));
    } catch {
      toast.error(t("demo.exportFailed"));
    } finally {
      setBusy(false);
    }
  };
  if (loadingAuth) return <output>{t("demo.loading")}</output>;
  if (expired || (!matchesSession && error))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p>{t(expired ? "demo.expired" : "demo.unavailable")}</p>
        <a className="btn" href="/demo">
          {t("demo.try")}
        </a>
      </div>
    );
  if (!session || !matchesSession) return <output>{t("demo.loading")}</output>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-tour="demo-intro" className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm">
        <p>{t("demo.banner", { expiresAt: new Date(session.expiresAt).toLocaleString() })}</p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-tour="demo-export"
          disabled={busy}
          onClick={() => void exportDemo()}
        >
          {t("demo.export")}
        </button>
        {error && <p role="alert">{t("demo.saveFailed")}</p>}
      </div>
      <div className="min-h-0 flex-1">
        <ProjectCanvasPage projectRef={session.projectId} />
      </div>
    </div>
  );
}
