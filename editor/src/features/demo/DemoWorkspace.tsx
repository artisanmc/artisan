import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectCanvasPage } from "@/features/project/ProjectWorkspace";
import { DemoApiError } from "@/lib/api/demo";
import { type NetworkSummary, createNetwork, listNetworks } from "@/lib/api/networks";
import { projectDestination } from "@/lib/projectNavigation";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEMO_AUTH_RETURN,
  bootstrapDemo,
  finishDemoClaim,
  getPendingDemoClaim,
  prepareDemoAuthentication,
} from "./demoLifecycle";

export function DemoEntry() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const pending = getPendingDemoClaim();
    if (pending) {
      void navigate({
        to: "/demo/projects/$projectId",
        params: { projectId: pending.session.projectId },
        replace: true,
      });
      return;
    }
    void bootstrapDemo(true)
      .then((session) => {
        if (cancelled || !session) return;
        useDemoStore.getState().setSession(session);
        void navigate({
          to: "/demo/projects/$projectId",
          params: { projectId: session.projectId },
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
  const navigate = useNavigate();
  const { t } = useTranslation();
  const session = useDemoStore((s) => s.session);
  const expired = useDemoStore((s) => s.expired);
  const user = useAuthStore((s) => s.currentUser);
  const loadingAuth = useAuthStore((s) => s.isLoading);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const pending = getPendingDemoClaim();
  const hasPending = !!pending;
  useEffect(() => {
    useDemoStore.getState().setActive(true);
    return () => useDemoStore.getState().setActive(false);
  }, []);
  useEffect(() => {
    if (hasPending || session?.projectId === projectId) return;
    let cancelled = false;
    void bootstrapDemo(false)
      .then((value) => {
        if (cancelled) return;
        if (!value || value.projectId !== projectId) {
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
  }, [projectId, session?.projectId, hasPending]);
  useEffect(() => {
    if (user && sessionStorage.getItem(DEMO_AUTH_RETURN)) setClaimOpen(true);
  }, [user]);
  useEffect(() => {
    if (!session || hasPending) return;
    const timer = window.setTimeout(
      () => useDemoStore.getState().expire(),
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session, hasPending]);
  const keep = async () => {
    setBusy(true);
    try {
      const next = await prepareDemoAuthentication();
      if (user) setClaimOpen(true);
      else await navigate({ to: "/signup", search: { next } });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  if (loadingAuth) return <output>{t("demo.loading")}</output>;
  if (pending)
    return (
      <div className="flex h-full items-center justify-center p-6">
        {user?.id === pending.ownerId ? (
          <ClaimDialog key={user.id} open onOpenChange={() => {}} />
        ) : (
          <div>
            <p>{t("demo.sameAccount")}</p>
            <a className="btn" href={`/login?next=${encodeURIComponent(window.location.pathname)}`}>
              {t("demo.signIn")}
            </a>
          </div>
        )}
      </div>
    );
  if (expired || (session?.projectId !== projectId && error))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p>{t(expired ? "demo.expired" : "demo.unavailable")}</p>
        <a className="btn" href="/demo">
          {t("demo.try")}
        </a>
      </div>
    );
  if (!session || session.projectId !== projectId) return <output>{t("demo.loading")}</output>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm">
        <p>{t("demo.banner", { expiresAt: new Date(session.expiresAt).toLocaleString() })}</p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void keep()}
        >
          {t("demo.keep")}
        </button>
        {error && <p role="alert">{t("demo.saveFailed")}</p>}
      </div>
      <div className="min-h-0 flex-1">
        <ProjectCanvasPage />
      </div>
      {claimOpen && user && <ClaimDialog key={user.id} open onOpenChange={setClaimOpen} />}
    </div>
  );
}

export function ClaimDialog({
  open,
  onOpenChange,
}: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ownerId = useAuthStore((s) => s.currentUser?.id);
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [networkId, setNetworkId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [pending, setPending] = useState(getPendingDemoClaim);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void listNetworks()
      .then((value) => {
        if (!cancelled) setNetworks(value);
      })
      .catch(() => {
        if (!cancelled) setError("demo.unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await finishDemoClaim(networkId);
      await navigate(projectDestination(result.networkId, result.projectId));
    } catch (cause) {
      setPending(getPendingDemoClaim());
      setError(
        cause instanceof Error && cause.message === "claim_target_unavailable"
          ? "demo.targetUnavailable"
          : "demo.claimFailed",
      );
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError("");
    const owner = useAuthStore.getState().currentUser;
    try {
      const network = await createNetwork(name.trim());
      if (useAuthStore.getState().currentUser !== owner) return;
      setNetworks((values) => [...values, network]);
      setNetworkId(network.id);
      setName("");
    } catch {
      if (useAuthStore.getState().currentUser !== owner) return;
      setCreationUncertain(true);
      setError("demo.createUncertain");
      try {
        const values = await listNetworks();
        if (useAuthStore.getState().currentUser === owner) setNetworks(values);
      } catch {}
    } finally {
      setBusy(false);
    }
  };
  const frozen = !!pending && !pending.blocked;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy && !pending) onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("demo.keep")}</DialogTitle>
          <DialogDescription>{t("demo.claimDescription")}</DialogDescription>
        </DialogHeader>
        {pending && (
          <output>{t(pending.blocked ? "demo.targetUnavailable" : "demo.pending")}</output>
        )}
        {!frozen && (
          <>
            <label className="field-label" htmlFor="demo-network">
              Network
            </label>
            <select
              id="demo-network"
              className="input"
              disabled={busy}
              value={networkId}
              onChange={(event) => setNetworkId(event.target.value)}
            >
              <option value="">{t("demo.chooseNetwork")}</option>
              {networks.map((network) => (
                <option value={network.id} key={network.id}>
                  {network.name}
                </option>
              ))}
            </select>
            {!creationUncertain && (
              <div className="flex gap-2">
                <input
                  className="input"
                  aria-label={t("demo.networkName")}
                  placeholder={t("demo.networkName")}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !name.trim()}
                  onClick={() => void create()}
                >
                  {t("demo.createNetwork")}
                </button>
              </div>
            )}
          </>
        )}
        {error && <p role="alert">{t(error)}</p>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (!frozen && !networkId)}
          onClick={() => void submit()}
        >
          {t(pending ? "demo.retry" : "demo.claim")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
