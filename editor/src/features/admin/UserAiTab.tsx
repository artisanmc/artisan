import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { HBar } from "@/components/ui/h-bar";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { type UserFocusDto, getUserFocus, grantCredits } from "@/lib/api/adminAiUsage";
import { formatCredits, formatTokens } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Period = "7d" | "30d";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** One network's balance, grant history, and inline "grant credits" form. */
function NetworkFocusCard({
  network,
  lang,
  onGranted,
}: {
  network: UserFocusDto["networks"][number];
  lang: string;
  onGranted: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Number(amount);
    if (busy) return;
    setBusy(true);
    const r = await grantCredits(network.id, n, note || undefined);
    setBusy(false);
    if (r.ok) {
      toast.success(t("admin.ai.user.grantOk"));
      setOpen(false);
      setAmount("");
      setNote("");
      onGranted();
    } else {
      toast.error(t("admin.ai.user.grantFail"));
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-medium text-[var(--text)]">{network.name}</span>
        <span className="text-[13px] tabular-nums text-[var(--text-mut)]">
          {t("admin.ai.user.balance")} · {formatCredits(network.balance, lang)}
        </span>
      </div>

      {network.grants.length === 0 ? (
        <p className="text-[12px] text-[var(--text-faint)]">{t("admin.ai.user.noGrants")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {network.grants.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between text-[12px] text-[var(--text-mut)]"
            >
              <span>
                {g.delta > 0 ? "+" : ""}
                {formatCredits(g.delta, lang)} · {g.reason}
                {g.note ? ` · ${g.note}` : ""}
              </span>
              <span>{new Date(g.createdAt).toLocaleDateString(lang)}</span>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField label={t("admin.ai.user.grantAmount")}>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28"
            />
          </FormField>
          <FormField label={t("admin.ai.user.grantNote")}>
            <Input
              value={note}
              placeholder={t("admin.ai.user.grantNote")}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
          <Button type="submit" size="sm" disabled={busy}>
            {t("admin.ai.user.grantBtn")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t("admin.ai.models.cancel")}
          </Button>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            {t("admin.ai.user.grantBtn")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** AI usage focus for a single user: stat cards, per-model breakdown, and per-network balance/grants. */
export function UserAiTab({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [period, setPeriod] = useState<Period>("30d");
  const [focus, setFocus] = useState<UserFocusDto | null>(null);

  const range = useMemo(() => {
    const from = isoDaysAgo(period === "7d" ? 7 : 30);
    const to = new Date().toISOString();
    return { from, to };
  }, [period]);

  function refetch() {
    getUserFocus(userId, range.from, range.to)
      .then((f) => {
        setFocus(f);
      })
      .catch((e: unknown) => {
        console.warn("[admin-ai] fetch failed:", e);
        setFocus(null);
      });
  }

  useEffect(() => {
    let cancelled = false;
    getUserFocus(userId, range.from, range.to)
      .then((f) => {
        if (!cancelled) setFocus(f);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn("[admin-ai] fetch failed:", e);
        setFocus(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, range.from, range.to]);

  const totals = focus?.totals;
  const byModelMax = useMemo(
    () => Math.max(1, ...(focus?.byModel.map((m) => m.creditsCharged) ?? [0])),
    [focus],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={period === "7d" ? "primary" : "outline"}
          size="sm"
          onClick={() => setPeriod("7d")}
        >
          {t("admin.ai.usage.range.7d")}
        </Button>
        <Button
          type="button"
          variant={period === "30d" ? "primary" : "outline"}
          size="sm"
          onClick={() => setPeriod("30d")}
        >
          {t("admin.ai.usage.range.30d")}
        </Button>
      </div>

      {!totals ? (
        <p className="text-[13px] text-[var(--text-mut)]">{t("admin.ai.user.noUsage")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={t("admin.ai.user.totalTurns")}
              value={formatCredits(totals.turns, lang)}
            />
            <StatCard
              label={t("admin.ai.user.totalCredits")}
              value={formatCredits(totals.creditsCharged, lang)}
            />
            <StatCard
              label={t("admin.ai.user.tokensInOut")}
              value={`${formatTokens(totals.inputTokens, lang)} / ${formatTokens(totals.outputTokens, lang)}`}
            />
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <span className="eyebrow">{t("admin.ai.user.byModel")}</span>
            {(focus?.byModel ?? []).map((m) => (
              <HBar
                key={`${m.provider}:${m.modelId ?? m.modelName}`}
                label={m.modelName}
                value={m.creditsCharged}
                max={byModelMax}
                caption={formatCredits(m.creditsCharged, lang)}
              />
            ))}
          </div>
        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow">{t("admin.ai.user.networks")}</h2>
        <div className="flex flex-col gap-3">
          {(focus?.networks ?? []).map((n) => (
            <NetworkFocusCard key={n.id} network={n} lang={lang} onGranted={refetch} />
          ))}
        </div>
      </section>
    </div>
  );
}
