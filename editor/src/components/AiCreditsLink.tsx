import { type AiCloud, getAiCloud } from "@/lib/api/ai";
import { cn } from "@/lib/cx";
import { visibleInterval } from "@/lib/visibleInterval";
import { useAiStatus } from "@/state/aiStatus";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** How often the balance is asked again while the editor is open (the hub keeps it a minute too). */
const REFRESH_MS = 60_000;

/**
 * The AI credits of the linked artisanmc.net account, at the bottom of the sidebar, when the
 * assistant runs on them (the `artisan` API, ADR `editor-assistant`). It opens the account page,
 * where credits are shown and, later, bought.
 */
export function AiCreditsLink() {
  const { t, i18n } = useTranslation();
  const status = useAiStatus();
  const [cloud, setCloud] = useState<AiCloud | null>(null);
  const on = status?.cloud === true;

  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () =>
      getAiCloud()
        .then((c) => live && setCloud(c))
        .catch(() => undefined);
    void load();
    const stop = visibleInterval(load, REFRESH_MS);
    return () => {
      live = false;
      stop();
    };
  }, [on]);

  if (!on || !cloud?.linked) return null;
  const balance = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(
    cloud.balance,
  );
  const label = t("ai.credits", { balance });
  const className = cn(
    "-mb-1.5 flex shrink-0 items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12.5px] font-medium transition-colors hover:bg-[var(--surface-hover)]",
    cloud.balance > 0 ? "text-[var(--text-mut)]" : "text-[var(--danger)]",
  );
  const content = (
    <>
      <Sparkles className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </>
  );
  return cloud.buy ? (
    <a
      href={cloud.buy}
      target="_blank"
      rel="noreferrer"
      title={t("ai.creditsHint")}
      data-testid="sidebar-ai-credits"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div data-testid="sidebar-ai-credits" className={className}>
      {content}
    </div>
  );
}
