import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { copyText } from "@/lib/clipboard";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PATTERNS, type Pattern, type PatternKind } from "./patterns";

interface PatternsGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KIND_BADGE: Record<PatternKind, string> = {
  lore: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/30",
  condition: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning-soft)]",
  action: "bg-[var(--brand-soft)] text-purple-200 border-purple-500/30",
};

export function PatternsGallery({ open, onOpenChange }: PatternsGalleryProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text)]"
      >
        <SheetHeader>
          <SheetTitle className="text-[var(--text)]">{t("patterns.title")}</SheetTitle>
        </SheetHeader>
        <p className="mt-2 text-[12px] text-[var(--text-mut)]">{t("patterns.intro")}</p>
        <div className="mt-4 space-y-3">
          {PATTERNS.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(pattern.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failures (older browsers, no permission) — silent
    }
  };

  return (
    <div className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${KIND_BADGE[pattern.kind]}`}
        >
          {pattern.kind}
        </span>
        <span className="text-[12px] font-semibold text-[var(--text)]">
          {t(`patterns.entries.${pattern.id}.name`)}
        </span>
      </div>
      <p className="mb-2 text-[11px] text-[var(--text-mut)]">
        {t(`patterns.entries.${pattern.id}.desc`)}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-[var(--surface)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)]">
          {pattern.snippet}
        </code>
        <button
          type="button"
          onClick={copy}
          title={t(copied ? "patterns.copied" : "patterns.copy")}
          className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-raised-2)] text-[var(--text-mut)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
