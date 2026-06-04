import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Key, Copy, Check } from "lucide-react";
import * as networksApi from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step2Server({ state, setState }: Props) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!state.networkId) return;
    setGenerating(true);
    try {
      const sk = await networksApi.createServerKey(state.networkId);
      setState((s) => ({ ...s, serverKey: sk.key, serverKeyId: sk.id }));
      setDone(true);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!state.serverKey) return;
    await navigator.clipboard.writeText(state.serverKey);
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

      {state.serverKey && (
        <div className="flex flex-col gap-2">
          <span className="field-label flex items-center gap-2">
            <Key className="size-[12px] text-[var(--warning)]" />
            {t("setupWizard.step2.keyLabel")}
            <span className="ml-1 rounded-full bg-[var(--warning-soft)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[var(--warning)]">
              {t("setupWizard.step2.shownOnce")}
            </span>
          </span>
          <div className="relative">
            <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-3 pr-12 text-[12.5px] text-[var(--text-mut)]">
              {state.serverKey}
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
        </div>
      )}

      <Button
        variant={done ? "outline" : "primary"}
        onClick={handleGenerate}
        disabled={generating || done}
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
