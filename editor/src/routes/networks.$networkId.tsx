import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, GitBranch, Trash2 } from "lucide-react";
import {
  getNetwork,
  deleteServerKey,
  listPackBindings,
  type PackBinding,
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
                    <button
                      onClick={() => handleDeleteKey(sk.id)}
                      className="btn btn-sm btn-danger shrink-0"
                    >
                      <Trash2 className="size-[13px]" />
                      {t("networkDetail.deleteKey")}
                    </button>
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
