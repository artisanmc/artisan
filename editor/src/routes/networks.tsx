import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useNetworksStore } from "@/state/networksStore";
import { listNetworks } from "@/lib/api/networks";

export const Route = createFileRoute("/networks")({ component: NetworksPage });

export function NetworksPage() {
  const { t } = useTranslation();
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);

  useEffect(() => {
    listNetworks().then(setNetworks).catch(console.error);
  }, [setNetworks]);

  return (
    <div className="grain relative min-h-screen bg-[var(--surface)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-7 px-8 py-12">
        <header className="flex flex-col gap-2">
          <h1
            className="display text-[36px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("networksPage.title")}
          </h1>
        </header>

        {networks.length === 0 ? (
          <div className="card flex flex-col gap-3 p-6">
            <p className="text-[14px] text-[var(--text-mut)]">
              <Trans
                i18nKey="networksPage.none"
                components={{
                  1: (
                    <code className="mono rounded-md bg-[var(--surface-inset)] px-1.5 py-0.5 text-[12.5px] text-[var(--text-mut)]" />
                  ),
                }}
                values={{ cmd: "/artisan setup" }}
              />
            </p>
            <Link to="/setup" className="btn btn-primary self-start">
              {t("networksPage.createNetwork")}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3">
            {networks.map((n) => (
              <li key={n.id}>
                <Link
                  to="/networks/$networkId"
                  params={{ networkId: n.id }}
                  className="card flex items-center justify-between gap-3 p-4 transition-colors hover:border-[var(--brand-line)]"
                >
                  <div className="flex flex-col">
                    <span className="text-[14px] font-semibold text-[var(--text)]">{n.name}</span>
                    <span className="text-[11px] text-[var(--text-faint)]">
                      {t("networksPage.tierLabel")}: {n.tier}
                    </span>
                  </div>
                  <span className="text-[11px] uppercase tracking-[.12em] text-[var(--text-faint)]">
                    {t("accountPage.networkBadge")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link
          to="/setup"
          className="self-start text-[12.5px] text-[var(--text-mut)] underline-offset-2 hover:text-[var(--brand)] hover:underline"
        >
          {t("networksPage.addNetwork")}
        </Link>
      </div>
    </div>
  );
}
