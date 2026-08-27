import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { type AiSettingsDto, getAiSettings, putAiSettings } from "@/lib/api/adminModels";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** micro-USD -> the $/credit amount shown/edited in the form. */
const microToDollars = (micro: number): string => (micro ? String(micro / 1_000_000) : "");
/** dollar amount typed by the admin -> micro-USD stored server-side. */
const dollarsToMicro = (dollars: string): number => Math.round((Number(dollars) || 0) * 1_000_000);

export function AiSettingsSection() {
  const { t } = useTranslation();
  const [creditUsdRate, setCreditUsdRate] = useState("");
  const [maxCreditsPerTurn, setMaxCreditsPerTurn] = useState("");
  const [marginPct, setMarginPct] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAiSettings()
      .then((s) => {
        if (!s) return;
        setCreditUsdRate(microToDollars(s.creditUsdMicroRate));
        setMaxCreditsPerTurn(s.maxCreditsPerTurn != null ? String(s.maxCreditsPerTurn) : "");
        setMarginPct(String(s.pricingMarginPct));
      })
      .catch((e: unknown) => {
        console.warn("[admin-ai] fetch failed:", e);
      });
  }, []);

  async function save() {
    setBusy(true);
    const patch: Partial<AiSettingsDto> = {
      creditUsdMicroRate: dollarsToMicro(creditUsdRate),
      maxCreditsPerTurn: maxCreditsPerTurn === "" ? null : Number(maxCreditsPerTurn),
      pricingMarginPct: Math.max(0, Math.round(Number(marginPct) || 0)),
    };
    const r = await putAiSettings(patch);
    setBusy(false);
    if (r.ok) toast.success(t("admin.ai.settings.saved"));
    else toast.error(t("admin.ai.saveFail"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.ai.settings.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex max-w-lg flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FormField
            label={t("admin.ai.settings.creditUsdRate")}
            hint={t("admin.ai.settings.creditUsdRateHint")}
          >
            <Input
              type="number"
              step="0.0001"
              value={creditUsdRate}
              onChange={(e) => setCreditUsdRate(e.target.value)}
            />
          </FormField>

          <FormField
            label={t("admin.ai.settings.marginPct")}
            hint={t("admin.ai.settings.marginPctHint")}
          >
            <Input
              type="number"
              step="1"
              value={marginPct}
              onChange={(e) => setMarginPct(e.target.value)}
            />
          </FormField>

          <FormField
            label={t("admin.ai.settings.maxCreditsPerTurn")}
            hint={t("admin.ai.settings.maxCreditsPerTurnHint")}
          >
            <Input
              type="number"
              value={maxCreditsPerTurn}
              placeholder={t("admin.ai.settings.uncapped")}
              onChange={(e) => setMaxCreditsPerTurn(e.target.value)}
            />
          </FormField>

          <Button type="submit" variant="primary" size="sm" disabled={busy} className="self-start">
            {t("admin.ai.settings.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
