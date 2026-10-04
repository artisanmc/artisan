import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ItemContextSidebar({ entries }: { entries: PlaceholderEntry[] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const [helpOpen, setHelpOpen] = useState(false);
  const visible = [...new Map(entries.map((entry) => [entry.path, entry])).values()].filter(
    (entry) => entry.path.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details
      open
      className="max-h-80 min-h-0 min-w-0 shrink-0 overflow-y-auto overscroll-contain border-t border-[var(--border)] pt-4 md:max-h-none md:border-l md:border-t-0 md:pl-4 md:pt-0 md:[contain:size]"
    >
      <summary className="field-label cursor-pointer">{t("itemContext.title")}</summary>
      <div className="mt-3 space-y-3">
        <Button variant="secondary" size="sm" onClick={() => setHelpOpen(true)}>
          {t("itemContext.help")}
        </Button>
        <PatternsGallery open={helpOpen} onOpenChange={setHelpOpen} />
        <p className="text-xs text-[var(--text-mut)]">{t("itemContext.intro")}</p>
        <Input
          aria-label={t("itemContext.search")}
          placeholder={t("itemContext.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {status && <output className="block text-xs text-[var(--text-mut)]">{status}</output>}
        {(["context", "iteration", "pagination", "source"] as const).map((origin) => {
          const group = visible.filter((entry) => entry.origin === origin);
          return (
            group.length > 0 && (
              <section key={origin}>
                <h3 className="eyebrow mb-2">{t(`itemContext.${origin}`)}</h3>
                <ul className="space-y-2">
                  {group.map((entry) => (
                    <li key={entry.path} className="card flex items-start gap-2 p-2">
                      <div className="min-w-0 flex-1">
                        <code className="break-all text-xs">{`{${entry.path}}`}</code>
                        <p className="text-xs text-[var(--text-mut)]">
                          {t(`itemContext.types.${entry.type}`)}
                        </p>
                        {entry.sample !== null && entry.sample !== "" && (
                          <p
                            className="mt-1 line-clamp-2 break-all text-xs text-[var(--text-faint)]"
                            title={entry.sample}
                          >
                            {entry.sample}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${t(copied === entry.path ? "patterns.copied" : "patterns.copy")} {${entry.path}}`}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(`{${entry.path}}`);
                            setStatus("");
                            setCopied(entry.path);
                            clearTimeout(copyTimer.current);
                            copyTimer.current = setTimeout(() => setCopied(null), 1500);
                          } catch {
                            setStatus(t("itemContext.copyError"));
                          }
                        }}
                      >
                        {copied === entry.path ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          );
        })}
        {visible.length === 0 && (
          <p className="text-xs text-[var(--text-mut)]">{t("itemContext.empty")}</p>
        )}
      </div>
    </details>
  );
}
