import { ConnectionHistoryModal } from "@/components/network-detail/ConnectionHistoryModal";
import { DeleteServerDialog } from "@/components/network-detail/DeleteServerDialog";
import { EditServerModal } from "@/components/network-detail/EditServerModal";
import { IpAllowlistModal } from "@/components/network-detail/IpAllowlistModal";
import { MembersSection } from "@/components/network-detail/MembersSection";
import { NewProjectModal } from "@/components/network-detail/NewProjectModal";
import { NewServerModal } from "@/components/network-detail/NewServerModal";
import { RequestAccessPanel } from "@/components/network-detail/RequestAccessPanel";
import { ServerCard } from "@/components/network-detail/ServerCard";
import {
  createProject,
  createServerKey,
  deleteServerKey,
  getNetwork,
  mintServerLinkCode,
  updateServerKey,
} from "@/lib/api/networks";
import { displayServerLabel } from "@/lib/serverLabel";
import { useAuthStore } from "@/state/authStore";
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
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const [detail, setDetail] = useState<NetworkDetail | null>(null);
  const [newServerOpen, setNewServerOpen] = useState(false);
  const [newWsForServer, setNewWsForServer] = useState<string | null>(null);
  const [historyServer, setHistoryServer] = useState<string | null>(null);
  const [editServer, setEditServer] = useState<{
    id: string;
    label: string | null;
    slug?: string;
  } | null>(null);
  const [allowlistServer, setAllowlistServer] = useState<string | null>(null);
  const [deleteServer, setDeleteServer] = useState<{
    id: string;
    label: string;
    projectCount: number;
  } | null>(null);
  const [revealedCode, setRevealedCode] = useState<{ keyId: string; code: string } | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const childMatches = useChildMatches();

  // Anonymous visitor → bounce to login, preserving the current URL (incl.
  // deep-linked child routes) so they land back here after signing in.
  useEffect(() => {
    if (authLoading || currentUser) return;
    const next = window.location.pathname + window.location.search;
    navigate({ to: "/login", search: { next }, replace: true });
  }, [authLoading, currentUser, navigate]);

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId)
      .then(setDetail)
      .catch((e: Error & { status?: number }) => {
        // A logged-in user without membership → offer to request access instead
        // of bouncing (deep-linked invite/share URL, e.g. from a Discord post).
        // A stale/nonexistent id (404) still bounces — nothing to request access to.
        if (e?.status === 403) {
          setAccessDenied(true);
        } else if (e?.status === 404) {
          navigate({ to: "/networks", replace: true });
        } else console.error(e);
      });
  }, [networkId, navigate]);

  if (accessDenied) return <RequestAccessPanel networkIdOrSlug={networkId} />;
  if (childMatches.length > 0) return <Outlet />;
  if (!detail)
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--text-mut)]">
        {t("networkDetail.loading")}
      </div>
    );

  // Group projects by server (1:N).
  const packsByServer = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const p of detail.projects) {
    const skId = p.serverKeyId;
    if (!skId) continue;
    const list = packsByServer.get(skId) ?? [];
    list.push({ id: p.id, name: p.name });
    packsByServer.set(skId, list);
  }

  const handleAction = async (action: string, serverId: string) => {
    if (action === "relink") {
      // Editor-first linking: mint a fresh code. Running `/artisan link <code>`
      // on the server rotates its key in place (same row + projects). Secrets
      // are never surfaced in the editor — only the code is.
      const { code } = await mintServerLinkCode(detail.network.id, serverId);
      setRevealedCode({ keyId: serverId, code });
    } else if (action === "edit") {
      const sk = detail.serverKeys.find((k) => k.id === serverId);
      if (sk) setEditServer({ id: sk.id, label: sk.label, slug: sk.slug });
    } else if (action === "history") {
      setHistoryServer(serverId);
    } else if (action === "allowlist") {
      setAllowlistServer(serverId);
    } else if (action === "delete") {
      const sk = detail.serverKeys.find((k) => k.id === serverId);
      if (!sk) return;
      const count = (packsByServer.get(serverId) ?? []).length;
      setDeleteServer({ id: serverId, label: displayServerLabel(sk), projectCount: count });
    }
  };

  const handleEditServer = async (updates: { label: string; slug: string }) => {
    if (!editServer) return;
    // Errors bubble to the modal, which maps codes (slug_taken…) to messages.
    const updated = await updateServerKey(detail.network.id, editServer.id, updates);
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
    setDetail({
      ...detail,
      serverKeys: detail.serverKeys.map((k) =>
        k.id === editServer.id ? { ...k, label: updated.label, slug: updated.slug } : k,
      ),
    });
  };

  const handleCreateServer = async (label: string) => {
    const created = await createServerKey(detail.network.id, label);
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
    setRevealedCode({ keyId: created.id, code: created.code });
    setDetail({
      ...detail,
      serverKeys: [
        ...detail.serverKeys,
        { id: created.id, label: created.label, slug: created.slug },
      ],
    });
  };

  const handleCreateProject = async (input: { name: string; description?: string }) => {
    if (!newWsForServer) return;
    const created = await createProject(
      detail.network.id,
      newWsForServer,
      input.name,
      input.description,
    );
    setDetail({ ...detail, projects: [...detail.projects, created] });
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteServer) return;
    await deleteServerKey(detail.network.id, deleteServer.id);
    useNetworksStore.getState().bumpRefresh(); // sync the sidebar
    setDetail({
      ...detail,
      serverKeys: detail.serverKeys.filter((k) => k.id !== deleteServer.id),
      projects: detail.projects.filter((p) => p.serverKeyId !== deleteServer.id),
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
          <div className="flex items-center gap-4">
            <Link
              to="/credits"
              className="flex items-center gap-1.5 text-[13px] text-[var(--text-mut)] hover:text-[var(--brand)]"
            >
              {t("networkDetail.billing")} <ArrowRight className="size-[14px]" />
            </Link>
            <Link
              to="/networks/$networkId/settings"
              params={{ networkId }}
              className="flex items-center gap-1.5 text-[13px] text-[var(--text-mut)] hover:text-[var(--brand)]"
            >
              {t("networkDetail.settings")} <ArrowRight className="size-[14px]" />
            </Link>
          </div>
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
                  server={{
                    id: sk.id,
                    slug: sk.slug ?? sk.id,
                    label: sk.label,
                    online: sk.online === true,
                  }}
                  workspaces={packsByServer.get(sk.id) ?? []}
                  onAction={handleAction}
                  onCreateProject={(serverId) => setNewWsForServer(serverId)}
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

        <MembersSection networkId={detail.network.id} />
      </div>

      <NewServerModal
        open={newServerOpen}
        onOpenChange={setNewServerOpen}
        onCreate={handleCreateServer}
      />
      {newWsForServer && (
        <NewProjectModal
          open
          onOpenChange={(o) => !o && setNewWsForServer(null)}
          serverLabel={(() => {
            const sk = detail.serverKeys.find((k) => k.id === newWsForServer);
            return sk ? displayServerLabel(sk) : "";
          })()}
          onCreate={handleCreateProject}
        />
      )}
      <EditServerModal
        open={!!editServer}
        onOpenChange={(o) => !o && setEditServer(null)}
        server={editServer}
        onSave={handleEditServer}
      />
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
      {revealedCode && (
        <LinkCodeModal code={revealedCode.code} onClose={() => setRevealedCode(null)} />
      )}
    </div>
  );
}

function LinkCodeModal({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const command = `/artisan link ${code}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(command);
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
          {t("networkDetail.linkRevealTitle")}
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
          {t("networkDetail.linkRevealHint")}
        </p>
        <div className="flex flex-col gap-2">
          <span className="field-label flex items-center gap-2">
            <Key className="size-[12px] text-[var(--brand)]" />
            {t("networkDetail.linkRevealLabel")}
          </span>
          <div className="relative">
            <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3 pr-12 text-[13px] text-[var(--text)]">
              {command}
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

export default NetworkDetailPage;
