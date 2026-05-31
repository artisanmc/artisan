import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PATTERNS, type Pattern, type PatternKind } from "./patterns";

interface PatternsGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KIND_BADGE: Record<PatternKind, string> = {
  lore: "bg-[var(--sage-soft)] text-[var(--terra)] border-[var(--terra)]/30",
  condition: "bg-[var(--gold-soft)] text-[var(--gold)] border-[var(--gold-soft)]",
  action: "bg-[var(--terra-soft)] text-purple-200 border-purple-500/30",
};

export function PatternsGallery({ open, onOpenChange }: PatternsGalleryProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl border-[var(--line-soft)] bg-[var(--bg-deep)] text-[var(--ink)]"
      >
        <SheetHeader>
          <SheetTitle className="text-[var(--ink)]">{t("patterns.title")}</SheetTitle>
        </SheetHeader>
        <p className="mt-2 text-[12px] text-[var(--ink-mut)]">{t("patterns.intro")}</p>
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
      await navigator.clipboard.writeText(pattern.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failures (older browsers, no permission) — silent
    }
  };

  return (
    <div className="rounded border border-[var(--line-soft)] bg-[var(--card-surface)] p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${KIND_BADGE[pattern.kind]}`}
        >
          {pattern.kind}
        </span>
        <span className="text-[12px] font-semibold text-[var(--ink)]">
          {t(`patterns.entries.${pattern.id}.name`)}
        </span>
      </div>
      <p className="mb-2 text-[11px] text-[var(--ink-mut)]">{t(`patterns.entries.${pattern.id}.desc`)}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-[var(--bg-deep)] px-2 py-1.5 font-mono text-[11px] text-[var(--ink)]">
          {pattern.snippet}
        </code>
        <button
          type="button"
          onClick={copy}
          title={t(copied ? "patterns.copied" : "patterns.copy")}
          className="flex h-7 w-7 items-center justify-center rounded border border-[var(--line)] bg-[var(--raised-2)] text-[var(--ink-2)] hover:bg-[var(--raised-2)] hover:text-[var(--ink)]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
