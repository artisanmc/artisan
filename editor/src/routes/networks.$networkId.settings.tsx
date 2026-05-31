import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { initNetworkTransfer } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const { t } = useTranslation();
  const { networkId } = useParams({ from: "/networks/$networkId/settings" });
  const [transferUrl, setTransferUrl] = useState<string | null>(null);
  const [transferExpires, setTransferExpires] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const r = await initNetworkTransfer(networkId);
      setTransferUrl(r.url);
      setTransferExpires(r.expiresAt);
    } catch {
      setError(t("networkSettings.generationError"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grain relative min-h-screen bg-[var(--bg)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-12">
        <h1
          className="display text-[36px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("networkSettings.title")}
        </h1>

        <section className="card flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1.5">
            <h2
              className="display text-[19px] text-[var(--ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("networkSettings.transferOwnershipTitle")}
            </h2>
            <p className="text-[13px] leading-relaxed text-[var(--ink-mut)]">
              {t("networkSettings.transferOwnershipDescription")}
            </p>
          </header>

          <div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn btn-primary"
            >
              {generating
                ? t("networkSettings.generating")
                : t("networkSettings.generateLink")}
            </button>
          </div>

          {transferUrl && (
            <div className="flex flex-col gap-1.5">
              <span className="field-label">{t("networkSettings.shareLink")}</span>
              <input
                readOnly
                value={transferUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="input mono text-[12px]"
              />
              {transferExpires && (
                <p className="text-[12px] text-[var(--ink-faint)]">
                  {t("networkSettings.expiresAt", {
                    date: new Date(transferExpires).toLocaleString(),
                  })}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-[13px] text-[var(--brick)]">{error}</p>}
        </section>
      </div>
    </div>
  );
}

export default SettingsRoute;
