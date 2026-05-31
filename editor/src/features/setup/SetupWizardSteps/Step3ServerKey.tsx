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

export function Step3ServerKey({ state, setState }: Props) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!state.networkId || !state.packId) return;
    setGenerating(true);
    try {
      const sk = await networksApi.createServerKey(state.networkId);
      await networksApi.bindPackToServerKey(state.networkId, state.packId, sk.id);
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
        className="display text-[20px] text-[var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("setupWizard.step3.title")}
      </h2>
      <p className="text-[13px] leading-relaxed text-[var(--ink-mut)]">
        {t("setupWizard.step3.description")}
      </p>

      {state.serverKey && (
        <div className="flex flex-col gap-2">
          <span className="field-label flex items-center gap-2">
            <Key className="size-[12px] text-[var(--gold)]" />
            {t("setupWizard.step3.keyLabel")}
            <span className="ml-1 rounded-full bg-[var(--gold-soft)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[var(--gold)]">
              {t("setupWizard.step3.shownOnce")}
            </span>
          </span>
          <div className="relative">
            <code className="mono block break-all rounded-[14px] border border-[var(--line)] bg-[var(--inset)] px-3 py-3 pr-12 text-[12.5px] text-[var(--sand)]">
              {state.serverKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute right-1.5 top-1.5 btn btn-icon btn-sm btn-ghost"
              aria-label={t("setupWizard.step3.copy")}
            >
              {copied ? (
                <Check className="size-[14px] text-[var(--sage)]" />
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
          ? t("setupWizard.step3.generated")
          : generating
            ? t("setupWizard.step3.generating")
            : t("setupWizard.step3.generate")}
      </Button>
    </div>
  );
}
