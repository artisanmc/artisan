import { getNetwork, initNetworkTransfer, updateNetwork } from "@/lib/api/networks";
import { slugify } from "@/lib/slug";
import { useNetworksStore } from "@/state/networksStore";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/networks/$networkId/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const { t } = useTranslation();
  const { networkId } = useParams({ from: "/networks/$networkId/settings" });
  const navigate = useNavigate();
  const [transferUrl, setTransferUrl] = useState<string | null>(null);
  const [transferExpires, setTransferExpires] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // "Général" section — name + slug, prefilled from the network.
  const [realNetworkId, setRealNetworkId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // networkId param is the slug — getNetwork resolves either form.
    getNetwork(networkId)
      .then((d) => {
        if (cancelled) return;
        setRealNetworkId(d.network.id);
        setName(d.network.name);
        setSlug(d.network.slug ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [networkId]);

  const handleSaveGeneral = async () => {
    if (!realNetworkId || name.trim().length === 0) return;
    const canonical = slugify(slug || name, "network");
    setSaving(true);
    setSaveState("idle");
    setSaveError(null);
    try {
      const updated = await updateNetwork(realNetworkId, {
        name: name.trim(),
        slug: canonical,
      });
      useNetworksStore.getState().bumpRefresh(); // sync the sidebar
      setName(updated.name);
      setSlug(updated.slug ?? "");
      setSaveState("saved");
      // Slug changed → the current URL is stale; move to the new one.
      if (updated.slug && updated.slug !== networkId) {
        navigate({
          to: "/networks/$networkId/settings",
          params: { networkId: updated.slug },
          replace: true,
        });
      }
    } catch (e) {
      const code = e instanceof Error ? e.message : "unknown";
      setSaveState("error");
      setSaveError(
        code === "slug_taken" ? t("networkSettings.slugTaken") : t("networkSettings.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      // networkId param is the network slug — resolve to the real id (getNetwork
      // accepts either) before the id-scoped transfer call.
      const detail = await getNetwork(networkId);
      const r = await initNetworkTransfer(detail.network.id);
      setTransferUrl(r.url);
      setTransferExpires(r.expiresAt);
    } catch {
      setError(t("networkSettings.generationError"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-12">
        <h1
          className="display text-[36px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("networkSettings.title")}
        </h1>

        <section className="card flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1.5">
            <h2
              className="display text-[19px] text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("networkSettings.generalTitle")}
            </h2>
            <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
              {t("networkSettings.generalDescription")}
            </p>
          </header>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t("networkSettings.nameField")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t("networkSettings.slugField")}</span>
            <input
              className="input mono text-[12px]"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onBlur={() => setSlug((s) => (s.trim() ? slugify(s) : s))}
            />
            <span className="text-[12px] text-[var(--text-faint)]">
              {t("networkSettings.slugHint")}
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveGeneral}
              disabled={saving || !realNetworkId || name.trim().length === 0}
              className="btn btn-primary"
            >
              {saving ? t("networkSettings.saving") : t("networkSettings.save")}
            </button>
            {saveState === "saved" && (
              <span className="text-[13px] text-[var(--success)]">
                {t("networkSettings.saved")}
              </span>
            )}
            {saveState === "error" && saveError && (
              <span className="text-[13px] text-[var(--danger)]">{saveError}</span>
            )}
          </div>
        </section>

        <section className="card flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1.5">
            <h2
              className="display text-[19px] text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("networkSettings.transferOwnershipTitle")}
            </h2>
            <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
              {t("networkSettings.transferOwnershipDescription")}
            </p>
          </header>

          <div>
            <button onClick={handleGenerate} disabled={generating} className="btn btn-primary">
              {generating ? t("networkSettings.generating") : t("networkSettings.generateLink")}
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
                <p className="text-[12px] text-[var(--text-faint)]">
                  {t("networkSettings.expiresAt", {
                    date: new Date(transferExpires).toLocaleString(),
                  })}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
        </section>
      </div>
    </div>
  );
}

export default SettingsRoute;
