import { ConnectionHistoryModal } from "@/components/network-detail/ConnectionHistoryModal";
import { DeleteServerDialog } from "@/components/network-detail/DeleteServerDialog";
import { IpAllowlistModal } from "@/components/network-detail/IpAllowlistModal";
import { NewServerModal } from "@/components/network-detail/NewServerModal";
import { NewWorkspaceModal } from "@/components/network-detail/NewWorkspaceModal";
import { ServerCard } from "@/components/network-detail/ServerCard";
import {
  createPack,
  createServerKey,
  deleteServerKey,
  getNetwork,
  rotateServerKey,
} from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useNetworksStore } from "@/state/networksStore";
import {
  Link,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { ArrowRight, Check, Copy, Key } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

type NetworkDetail = Awaited<ReturnType<typeof getNetwork>>;

export function NetworkDetailPage() {
  const { t } = useTranslation();
  const { networkId } = useParams({ strict: false }) as { networkId: string };
  const navigate = useNavigate();
  const [detail, setDetail] = useState<NetworkDetail | null>(null);
  const [newServerOpen, setNewServerOpen] = useState(false);
  const [newWsForServer, setNewWsForServer] = useState<string | null>(null);
  const [historyServer, setHistoryServer] = useState<string | null>(null);
  const [allowlistServer, setAllowlistServer] = useState<string | null>(null);
  const [deleteServer, setDeleteServer] = useState<{
    id: string;
    label: string;
    workspaceCount: number;
  } | null>(null);
  const [revealedKey, setRevealedKey] = useState<{ keyId: string; key: string } | null>(null);
  const childMatches = useChildMatches();

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId)
      .then(setDetail)
      .catch((e: Error & { status?: number }) => {
        // Stale/inaccessible network (e.g. a URL left over from another account)
        // → bounce to the user's own networks list, don't loop a broken page.
        if (e?.status === 403 || e?.status === 404) navigate({ to: "/networks", replace: true });
        else console.error(e);
      });
  }, [networkId, navigate]);

  if (childMatches.length > 0) return <Outlet />;
  if (!detail)
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--text-mut)]">
        {t("networkDetail.loading")}
      </div>
    );

  // Group packs by server (1:N).
  const packsByServer = new Map<string, Array<{ id: string; name: string }>>();
  for (const p of detail.packs) {
    const skId = p.serverKeyId;
    if (!skId) continue;
    const list = packsByServer.get(skId) ?? [];
    list.push({ id: p.id, name: p.name });
    packsByServer.set(skId, list);
  }

  const handleAction = async (action: string, serverId: string) => {
    if (action === "show-key") {
      // V1: "Show key" generates a fresh one (only way to surface plaintext).
      const result = await rotateServerKey(detail.network.id, serverId);
      setRevealedKey({ keyId: serverId, key: result.key });
    } else if (action === "rotate") {
      if (!window.confirm(t("networkDetail.confirmRotateKey"))) return;
      const result = await rotateServerKey(detail.network.id, serverId);
      setRevealedKey({ keyId: serverId, key: result.key });
    } else if (action === "history") {
      setHistoryServer(serverId);
    } else if (action === "allowlist") {
      setAllowlistServer(serverId);
    } else if (action === "delete") {
      const sk = detail.serverKeys.find((k) => k.id === serverId);
      if (!sk) return;
      const count = (packsByServer.get(serverId) ?? []).length;
      setDeleteServer({ id: serverId, label: displayServerLabel(sk), workspaceCount: count });
    }
  };

  const handleCreateServer = async (label: string) => {
    const created = await createServerKey(detail.network.id, label);
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
    setRevealedKey({ keyId: created.id, key: created.key });
    setDetail({
      ...detail,
      serverKeys: [
        ...detail.serverKeys,
        { id: created.id, label: created.label, slug: created.slug },
      ],
    });
  };

  const handleCreateWorkspace = async (input: { name: string; description?: string }) => {
    if (!newWsForServer) return;
    const created = await createPack(
      detail.network.id,
      newWsForServer,
      input.name,
      input.description,
    );
    setDetail({ ...detail, packs: [...detail.packs, created] });
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteServer) return;
    await deleteServerKey(detail.network.id, deleteServer.id);
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
    setDetail({
      ...detail,
      serverKeys: detail.serverKeys.filter((k) => k.id !== deleteServer.id),
      packs: detail.packs.filter((p) => p.serverKeyId !== deleteServer.id),
    });
    setDeleteServer(null);
  };

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header className="flex items-baseline justify-between">
          <h1
            className="display text-[36px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {detail.network.name}
          </h1>
          <Link
            to="/networks/$networkId/settings"
            params={{ networkId }}
            className="flex items-center gap-1.5 text-[13px] text-[var(--text-mut)] hover:text-[var(--brand)]"
          >
            {t("networkDetail.settings")} <ArrowRight className="size-[14px]" />
          </Link>
        </header>

        <section className="flex flex-col gap-3">
          {detail.serverKeys.length === 0 ? (
            <div className="card flex flex-col gap-3 p-6">
              <p className="text-[13.5px] text-[var(--text-mut)]">{t("networkDetail.noServers")}</p>
              <button
                onClick={() => setNewServerOpen(true)}
                className="btn btn-sm btn-primary self-start"
              >
                {t("networkDetail.addServer")}
              </button>
            </div>
          ) : (
            <>
              {detail.serverKeys.map((sk) => (
                <ServerCard
                  key={sk.id}
                  networkId={detail.network.id}
                  server={{ id: sk.id, slug: sk.slug, label: sk.label, online: false }}
                  workspaces={packsByServer.get(sk.id) ?? []}
                  onAction={handleAction}
                  onCreateWorkspace={(serverId) => setNewWsForServer(serverId)}
                />
              ))}
              <button
                onClick={() => setNewServerOpen(true)}
                className="btn btn-sm btn-ghost self-start"
              >
                + {t("networkDetail.addServer")}
              </button>
            </>
          )}
        </section>

        <Section title={t("networkDetail.members")}>
          <p className="text-[12px] text-[var(--text-faint)]">
            {t("networkDetail.membersComingSoon")}
          </p>
        </Section>
      </div>

      <NewServerModal
        open={newServerOpen}
        onOpenChange={setNewServerOpen}
        onCreate={handleCreateServer}
      />
      {newWsForServer && (
        <NewWorkspaceModal
          open
          onOpenChange={(o) => !o && setNewWsForServer(null)}
          serverLabel={(() => {
            const sk = detail.serverKeys.find((k) => k.id === newWsForServer);
            return sk ? displayServerLabel(sk) : "";
          })()}
          onCreate={handleCreateWorkspace}
        />
      )}
      {historyServer && (
        <ConnectionHistoryModal
          open
          onOpenChange={(o) => !o && setHistoryServer(null)}
          networkId={networkId}
          serverId={historyServer}
        />
      )}
      {allowlistServer && (
        <IpAllowlistModal
          open
          onOpenChange={(o) => !o && setAllowlistServer(null)}
          networkId={networkId}
          serverId={allowlistServer}
        />
      )}
      {deleteServer && (
        <DeleteServerDialog
          server={deleteServer}
          onCancel={() => setDeleteServer(null)}
          onConfirm={handleDeleteConfirmed}
        />
      )}
      {revealedKey && (
        <RotatedKeyModal plainKey={revealedKey.key} onClose={() => setRevealedKey(null)} />
      )}
    </div>
  );
}

function RotatedKeyModal({ plainKey, onClose }: { plainKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(plainKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

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
          {t("networkDetail.rotateRevealTitle")}
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
          {t("networkDetail.rotateRevealHint")}
        </p>
        <div className="flex flex-col gap-2">
          <span className="field-label flex items-center gap-2">
            <Key className="size-[12px] text-[var(--warning)]" />
            {t("networkDetail.rotateRevealKeyLabel")}
            <span className="ml-1 rounded-full bg-[var(--warning-soft)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[var(--warning)]">
              {t("networkDetail.rotateRevealShownOnce")}
            </span>
          </span>
          <div className="relative">
            <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3 pr-12 text-[12.5px] text-[var(--text-mut)]">
              {plainKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute right-1.5 top-1.5 btn btn-icon btn-sm btn-ghost"
              aria-label={t("networkDetail.copy")}
            >
              {copied ? (
                <Check className="size-[14px] text-[var(--success)]" />
              ) : (
                <Copy className="size-[14px]" />
              )}
            </button>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-sm btn-primary">
            {t("networkDetail.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="eyebrow">{title}</h2>
        <span className="h-px flex-1 bg-[var(--border-soft)]" />
      </div>
      {children}
    </section>
  );
}

export default NetworkDetailPage;
