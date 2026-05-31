import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";

interface TrustGatePageProps {
  trustCode: string;
}

export function TrustGatePage({ trustCode }: TrustGatePageProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const command = `/artisan trusteditor ${trustCode}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grain relative flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] px-4 py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(223,107,65,.06), transparent 60%)",
        }}
      />
      <div className="card relative z-[1] flex w-full max-w-md flex-col items-center gap-5 p-7 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--gold-soft)] bg-[var(--gold-soft)]">
          <ShieldCheck className="h-6 w-6 text-[var(--gold)]" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h1
            className="display text-[22px] tracking-tight text-[var(--ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("trustGate.title")}
          </h1>
          <p className="text-[13.5px] leading-relaxed text-[var(--ink-mut)]">
            {t("trustGate.description")}
          </p>
        </div>

        <div className="flex w-full items-center gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--inset)] px-3 py-2.5">
          <code className="mono flex-1 break-all text-left text-[13px] text-[var(--gold)]">
            {command}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="btn btn-sm btn-outline shrink-0"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[var(--sage)]" />
                <span className="text-[var(--sage)]">{t("trustGate.copied")}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>{t("trustGate.copy")}</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 text-[12.5px] text-[var(--ink-faint)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--terra)]" />
          <span>{t("trustGate.waiting")}</span>
        </div>
      </div>
    </div>
  );
}
