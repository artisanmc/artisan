import { NewServerModal } from "@/components/network-detail/NewServerModal";
import { createServerKey, getNetwork, listNetworks } from "@/lib/api/networks";
import type { NetworkSummary, ProjectSummary, ServerKeySummary } from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import {
  Link,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/networks")({ component: NetworksPage });

interface NetworkData {
  network: NetworkSummary;
  serverKeys: ServerKeySummary[];
  projects: ProjectSummary[];
}

/** Inline modal shown after creating a server: the `/artisan link <code>` command. */
function RevealKeyModal({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card flex w-full max-w-lg flex-col gap-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="display text-[20px] text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("networksHub.serverCreated")}
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
          {t("networksHub.serverCreatedHint")}
        </p>
        <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3 text-[13px] text-[var(--text)]">
          /artisan link {code}
        </code>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-sm btn-primary">
            {t("networksHub.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NetworksPage() {
  const { t } = useTranslation();
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);
  const childMatches = useChildMatches();
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();

  const [networkData, setNetworkData] = useState<NetworkData[]>([]);
  const [addingServerTo, setAddingServerTo] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // Anonymous visitor → bounce to login, preserving the current URL (incl.
  // deep-linked child routes) so they land back here after signing in.
  useEffect(() => {
    if (authLoading || currentUser) return;
    const next = window.location.pathname + window.location.search;
    navigate({ to: "/login", search: { next }, replace: true });
  }, [authLoading, currentUser, navigate]);

  useEffect(() => {
    listNetworks().then(setNetworks).catch(console.error);
  }, [setNetworks]);

  useEffect(() => {
    if (networks.length === 0) {
      setNetworkData([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      networks.map((n) =>
        getNetwork(n.id).then((d) => ({
          network: n,
          serverKeys: d.serverKeys,
          projects: d.projects,
        })),
      ),
    )
      .then((results) => {
        if (!cancelled) setNetworkData(results);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [networks]);

  if (childMatches.length > 0) return <Outlet />;

  const handleCreateServer = async (label: string) => {
    if (!addingServerTo) return;
    const created = await createServerKey(addingServerTo, label);
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
    setRevealedKey(created.code);
    // Refresh that network's data
    setNetworkData((prev) =>
      prev.map((nd) =>
        nd.network.id === addingServerTo
          ? {
              ...nd,
              serverKeys: [
                ...nd.serverKeys,
                { id: created.id, label: created.label, slug: created.slug },
              ],
            }
          : nd,
      ),
    );
    setAddingServerTo(null);
  };

  return (
    <div className="grain relative min-h-screen bg-[var(--surface)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        {/* Page header */}
        <header className="flex items-baseline justify-between gap-4">
          <h1
            className="display text-[36px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("networksPage.title")}
          </h1>
          <Link to="/setup" className="btn btn-sm btn-primary shrink-0">
            {t("networksHub.createNetwork")}
          </Link>
        </header>

        {networks.length === 0 ? (
          <div className="card flex flex-col gap-3 p-6">
            <p className="text-[14px] text-[var(--text-mut)]">{t("networksHub.noNetworks")}</p>
            <Link to="/setup" className="btn btn-primary self-start">
              {t("networksHub.createNetwork")}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {networkData.map((nd) => {
              const projectsByServer = new Map<string, ProjectSummary[]>();
              for (const p of nd.projects) {
                if (!p.serverKeyId) continue;
                const list = projectsByServer.get(p.serverKeyId) ?? [];
                list.push(p);
                projectsByServer.set(p.serverKeyId, list);
              }

              return (
                <section key={nd.network.id} className="flex flex-col gap-3">
                  {/* Network header */}
                  <div className="flex items-center gap-3">
                    <h2
                      className="text-[18px] font-semibold text-[var(--text)]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {nd.network.name}
                    </h2>
                    <Link
                      to="/networks/$networkId"
                      params={{ networkId: nd.network.slug ?? nd.network.id }}
                      className="flex items-center gap-1 text-[12px] text-[var(--text-faint)] hover:text-[var(--brand)]"
                    >
                      {t("networksHub.manageServers")}
                      <ArrowRight className="size-[12px]" />
                    </Link>
                    <Link
                      to="/networks/$networkId/settings"
                      params={{ networkId: nd.network.slug ?? nd.network.id }}
                      className="flex items-center gap-1 text-[12px] text-[var(--text-faint)] hover:text-[var(--brand)]"
                    >
                      {t("networksHub.networkSettings")}
                      <ArrowRight className="size-[12px]" />
                    </Link>
                    <span className="h-px flex-1 bg-[var(--border-soft)]" />
                  </div>

                  {/* Servers list */}
                  {nd.serverKeys.length === 0 ? (
                    <div className="card flex flex-col gap-3 p-5">
                      <p className="text-[13px] text-[var(--text-mut)]">
                        {t("networksHub.noServers")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setAddingServerTo(nd.network.id)}
                        className="btn btn-sm btn-primary self-start"
                      >
                        {t("networksHub.addServer")}
                      </button>
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {nd.serverKeys.map((sk) => {
                        const wsForServer = projectsByServer.get(sk.id) ?? [];
                        const wsCount = wsForServer.length;
                        return (
                          <li key={sk.id}>
                            <Link
                              to="/networks/$networkId/servers/$serverId"
                              params={{
                                networkId: nd.network.slug ?? nd.network.id,
                                serverId: sk.slug ?? sk.id,
                              }}
                              className="card flex items-center justify-between gap-3 p-4 hover:border-[var(--brand-line)]"
                            >
                              <div className="flex flex-1 flex-col gap-0.5">
                                <span className="text-[14px] font-medium text-[var(--text)]">
                                  {displayServerLabel(sk)}
                                </span>
                                <span className="text-[11px] text-[var(--text-faint)]">
                                  {t("networksHub.projectCount", { count: wsCount })}
                                </span>
                              </div>
                              <ArrowRight className="size-[14px] shrink-0 text-[var(--text-faint)]" />
                            </Link>
                          </li>
                        );
                      })}
                      <li>
                        <button
                          type="button"
                          onClick={() => setAddingServerTo(nd.network.id)}
                          className="text-[12.5px] text-[var(--text-mut)] underline-offset-2 hover:text-[var(--brand)] hover:underline"
                        >
                          {t("networksHub.addServer")}
                        </button>
                      </li>
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <NewServerModal
        open={addingServerTo !== null}
        onOpenChange={(o) => !o && setAddingServerTo(null)}
        onCreate={handleCreateServer}
      />

      {revealedKey && <RevealKeyModal code={revealedKey} onClose={() => setRevealedKey(null)} />}
    </div>
  );
}
