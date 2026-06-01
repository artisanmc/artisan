import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, GitBranch, Key, Plus, RefreshCw, Shield, Trash2, X } from "lucide-react";
import {
  getNetwork,
  deleteServerKey,
  getServerKeyAllowlist,
  listPackBindings,
  listServerKeyHelloes,
  rotateServerKey,
  setServerKeyAllowlist,
  type PackBinding,
  type ServerKeyHello,
} from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

type NetworkDetail = Awaited<ReturnType<typeof getNetwork>>;

type BindingWithPackName = PackBinding & { packId: string; packName: string };

export function NetworkDetailPage() {
  const { t } = useTranslation();
  const { networkId } = useParams({ strict: false }) as { networkId: string };
  const [detail, setDetail] = useState<NetworkDetail | null>(null);
  /** Indexed by serverKeyId for fast lookup when rendering the server-key cards. */
  const [bindingsByKey, setBindingsByKey] = useState<Record<string, BindingWithPackName[]>>({});
  /** The plaintext of a freshly rotated key — shown once in a modal, never persisted. */
  const [revealedKey, setRevealedKey] = useState<{ keyId: string; key: string } | null>(null);

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId).then(setDetail).catch(console.error);
  }, [networkId]);

  // Once we have the pack list, fan-out fetch the bindings so each server_key
  // card can list the packs running on it (with their target branch).
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    Promise.all(
      detail.packs.map((p) =>
        listPackBindings(networkId, p.id)
          .then((bs) => bs.map((b) => ({ ...b, packId: p.id, packName: p.name })))
          .catch(() => [] as BindingWithPackName[]),
      ),
    ).then((perPack) => {
      if (cancelled) return;
      const grouped: Record<string, BindingWithPackName[]> = {};
      for (const list of perPack) {
        for (const b of list) {
          (grouped[b.serverKeyId] ??= []).push(b);
        }
      }
      setBindingsByKey(grouped);
    });
    return () => { cancelled = true; };
  }, [detail, networkId]);

  if (!detail)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-8 text-[var(--ink-mut)]">
        {t("networkDetail.loading")}
      </div>
    );

  const handleDeleteKey = async (keyId: string) => {
    if (!window.confirm(t("networkDetail.confirmDeleteKey"))) return;
    await deleteServerKey(networkId, keyId);
    setDetail({
      ...detail,
      serverKeys: detail.serverKeys.filter((k) => k.id !== keyId),
    });
  };

  const handleRotateKey = async (keyId: string) => {
    if (!window.confirm(t("networkDetail.confirmRotateKey"))) return;
    const { key } = await rotateServerKey(networkId, keyId);
    setRevealedKey({ keyId, key });
  };

  return (
    <div className="grain relative min-h-screen bg-[var(--bg)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header className="flex items-baseline justify-between">
          <h1
            className="display text-[36px] tracking-tight text-[var(--ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {detail.network.name}
          </h1>
          <Link
            to="/networks/$networkId/settings"
            params={{ networkId }}
            className="flex items-center gap-1.5 text-[13px] text-[var(--ink-mut)] hover:text-[var(--terra)]"
          >
            {t("networkDetail.settings")} <ArrowRight className="size-[14px]" />
          </Link>
        </header>

        <Section title={t("networkDetail.packs")}>
          {detail.packs.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mut)]">{t("networkDetail.noPacks")}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {detail.packs.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/workspace/$workspaceId"
                    params={{ workspaceId: p.id }}
                    className="card flex items-center justify-between p-4 transition-colors hover:border-[var(--terra-line)]"
                  >
                    <span className="text-[14px] font-semibold text-[var(--ink)]">{p.name}</span>
                    <ArrowRight className="size-[14px] text-[var(--ink-faint)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("networkDetail.serverKeys")}>
          {detail.serverKeys.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mut)]">{t("networkDetail.noServerKeys")}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {detail.serverKeys.map((sk) => (
                <li
                  key={sk.id}
                  className="card flex flex-col gap-3 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">
                        {sk.label ?? sk.id.slice(0, 12)}
                      </span>
                      <span className="mono truncate text-[11px] text-[var(--ink-faint)]">
                        {sk.id}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => handleRotateKey(sk.id)}
                        className="btn btn-sm btn-ghost"
                      >
                        <RefreshCw className="size-[13px]" />
                        {t("networkDetail.rotateKey")}
                      </button>
                      <button
                        onClick={() => handleDeleteKey(sk.id)}
                        className="btn btn-sm btn-danger"
                      >
                        <Trash2 className="size-[13px]" />
                        {t("networkDetail.deleteKey")}
                      </button>
                    </div>
                  </div>

                  {bindingsByKey[sk.id]?.length ? (
                    <ul className="flex flex-col gap-1 border-t border-[var(--line-soft)] pt-2.5">
                      {bindingsByKey[sk.id]!.map((b) => (
                        <li key={b.bindingId}>
                          <Link
                            to="/workspace/$workspaceId"
                            params={{ workspaceId: b.packId }}
                            className="group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[var(--hover)]"
                          >
                            <span className="truncate text-[12.5px] text-[var(--ink-2)] group-hover:text-[var(--ink)]">
                              {b.packName}
                            </span>
                            <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-mut)]">
                              <GitBranch className="size-[11px]" />
                              {b.branchName}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="border-t border-[var(--line-soft)] pt-2.5 text-[11.5px] text-[var(--ink-faint)]">
                      {t("networkDetail.serverKeyNoPacks")}
                    </p>
                  )}

                  <HelloAuditPanel networkId={networkId} keyId={sk.id} />
                  <AllowlistPanel networkId={networkId} keyId={sk.id} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("networkDetail.members")}>
          <p className="text-[12px] text-[var(--ink-faint)]">
            {t("networkDetail.membersComingSoon")}
          </p>
        </Section>
      </div>

      {revealedKey && (
        <RotatedKeyModal
          plainKey={revealedKey.key}
          onClose={() => setRevealedKey(null)}
        />
      )}
    </div>
  );
}

function HelloAuditPanel({ networkId, keyId }: { networkId: string; keyId: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [helloes, setHelloes] = useState<ServerKeyHello[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || helloes !== null) return;
    listServerKeyHelloes(networkId, keyId)
      .then(setHelloes)
      .catch(() => setError(true));
  }, [open, helloes, networkId, keyId]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language); } catch { return iso; }
  };

  return (
    <div className="border-t border-[var(--line-soft)] pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-[11.5px] text-[var(--ink-mut)] hover:text-[var(--ink)]"
      >
        {open ? <ChevronDown className="size-[12px]" /> : <ChevronRight className="size-[12px]" />}
        {t("networkDetail.helloAuditToggle")}
      </button>
      {open && (
        <div className="mt-2">
          {error ? (
            <p className="text-[11.5px] text-[var(--ink-faint)]">{t("networkDetail.helloAuditError")}</p>
          ) : helloes === null ? (
            <p className="text-[11.5px] text-[var(--ink-faint)]">{t("networkDetail.loading")}</p>
          ) : helloes.length === 0 ? (
            <p className="text-[11.5px] text-[var(--ink-faint)]">{t("networkDetail.helloAuditEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {helloes.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] text-[var(--ink-2)]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="mono truncate text-[var(--ink-mut)]">{h.ip}</span>
                    {h.rejectedReason && (
                      <span className="badge badge-danger shrink-0 text-[9.5px]">
                        {t(`networkDetail.helloRejected.${h.rejectedReason}`, h.rejectedReason)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {h.mcVersion && (
                      <span className="text-[10.5px] text-[var(--ink-faint)]">MC {h.mcVersion}</span>
                    )}
                    <span className="text-[var(--ink-mut)]">{fmt(h.helloAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AllowlistPanel({ networkId, keyId }: { networkId: string; keyId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [ips, setIps] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    getServerKeyAllowlist(networkId, keyId)
      .then((list) => { setIps(list); setLoaded(true); })
      .catch(() => setError("load"));
  }, [open, loaded, networkId, keyId]);

  async function persist(next: string[] | null) {
    setBusy(true);
    setError(null);
    try {
      const saved = await setServerKeyAllowlist(networkId, keyId, next);
      setIps(saved);
    } catch {
      setError("save");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const value = draft.trim();
    if (!value) return;
    const current = ips ?? [];
    if (current.includes(value)) { setDraft(""); return; }
    await persist([...current, value]);
    setDraft("");
  }

  async function handleRemove(ip: string) {
    const next = (ips ?? []).filter((x) => x !== ip);
    await persist(next.length === 0 ? null : next);
  }

  const enabled = (ips?.length ?? 0) > 0;

  return (
    <div className="border-t border-[var(--line-soft)] pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-[11.5px] text-[var(--ink-mut)] hover:text-[var(--ink)]"
      >
        {open ? <ChevronDown className="size-[12px]" /> : <ChevronRight className="size-[12px]" />}
        <Shield className="size-[12px]" />
        {t("networkDetail.allowlistToggle")}
        {loaded && (
          <span className={`badge ml-auto text-[9.5px] ${enabled ? "badge-sage" : ""}`}>
            {enabled ? t("networkDetail.allowlistOn", { count: ips!.length }) : t("networkDetail.allowlistOff")}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-[var(--ink-faint)]">
            {t("networkDetail.allowlistHelp")}
          </p>
          {!loaded ? (
            <p className="text-[11.5px] text-[var(--ink-faint)]">{t("networkDetail.loading")}</p>
          ) : (
            <>
              {(ips ?? []).map((ip) => (
                <div
                  key={ip}
                  className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--line-soft)] px-2 py-1.5"
                >
                  <span className="mono truncate text-[11.5px] text-[var(--ink-2)]">{ip}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(ip)}
                    disabled={busy}
                    className="btn btn-icon btn-sm btn-ghost"
                    aria-label={t("networkDetail.allowlistRemove")}
                  >
                    <X className="size-[12px]" />
                  </button>
                </div>
              ))}
              <form
                onSubmit={(e) => { e.preventDefault(); void handleAdd(); }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("networkDetail.allowlistPlaceholder")}
                  disabled={busy}
                  className="input mono h-[28px] flex-1 text-[11.5px]"
                />
                <button type="submit" disabled={busy || !draft.trim()} className="btn btn-sm">
                  <Plus className="size-[12px]" /> {t("networkDetail.allowlistAdd")}
                </button>
              </form>
              {error && (
                <p className="text-[11px] text-[var(--danger)]">{t(`networkDetail.allowlistError.${error}`)}</p>
              )}
            </>
          )}
        </div>
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
          className="display text-[20px] text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("networkDetail.rotateRevealTitle")}
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--ink-mut)]">
          {t("networkDetail.rotateRevealHint")}
        </p>
        <div className="flex flex-col gap-2">
          <span className="field-label flex items-center gap-2">
            <Key className="size-[12px] text-[var(--gold)]" />
            {t("networkDetail.rotateRevealKeyLabel")}
            <span className="ml-1 rounded-full bg-[var(--gold-soft)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[var(--gold)]">
              {t("networkDetail.rotateRevealShownOnce")}
            </span>
          </span>
          <div className="relative">
            <code className="mono block break-all rounded-[14px] border border-[var(--line)] bg-[var(--inset)] px-3 py-3 pr-12 text-[12.5px] text-[var(--sand)]">
              {plainKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute right-1.5 top-1.5 btn btn-icon btn-sm btn-ghost"
              aria-label={t("networkDetail.copy")}
            >
              {copied ? (
                <Check className="size-[14px] text-[var(--sage)]" />
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
        <span className="h-px flex-1 bg-[var(--line-soft)]" />
      </div>
      {children}
    </section>
  );
}

export default NetworkDetailPage;
