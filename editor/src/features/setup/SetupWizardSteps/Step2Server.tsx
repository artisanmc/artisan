import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as networksApi from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { Check, Copy, Key } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step2Server({ state, setState }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!state.networkId || name.trim().length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const sk = await networksApi.createServerKey(state.networkId, name.trim());
      useNetworksStore.getState().bumpRefresh(); // sync the sidebar
      setState((s) => ({ ...s, linkCode: sk.code, serverKeyId: sk.id }));
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "server_limit_reached" ? "limit" : "generic");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!state.linkCode) return;
    await navigator.clipboard.writeText(`/artisan link ${state.linkCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2
        className="display text-[20px] text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("setupWizard.step2.title")}
      </h2>
      <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
        {t("setupWizard.step2.description")}
      </p>
      {error && <p role="alert" className="text-sm text-[var(--danger)]">{t(`newServerModal.${error}`)}</p>}

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("setupWizard.step2.nameLabel")}</span>
        <Input
          placeholder={t("setupWizard.step2.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={done}
        />
      </div>

      {state.linkCode && (
        <div className="flex flex-col gap-2">
          <span className="field-label flex items-center gap-2">
            <Key className="size-[12px] text-[var(--brand)]" />
            {t("setupWizard.step2.codeLabel")}
          </span>
          <div className="relative">
            <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3 pr-12 text-[13px] text-[var(--text)]">
              /artisan link {state.linkCode}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute right-1.5 top-1.5 btn btn-icon btn-sm btn-ghost"
              aria-label={t("setupWizard.step2.copy")}
            >
              {copied ? (
                <Check className="size-[14px] text-[var(--success)]" />
              ) : (
                <Copy className="size-[14px]" />
              )}
            </button>
          </div>
          <span className="text-[11px] text-[var(--text-faint)]">
            {t("setupWizard.step2.codeHint")}
          </span>
        </div>
      )}

      <Button
        variant={done ? "outline" : "primary"}
        onClick={handleGenerate}
        disabled={generating || done || name.trim().length === 0}
      >
        {done
          ? t("setupWizard.step2.generated")
          : generating
            ? t("setupWizard.step2.generating")
            : t("setupWizard.step2.generate")}
      </Button>
    </div>
  );
}
