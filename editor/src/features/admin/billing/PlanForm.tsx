import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type AdminPlan, type PlanInput, createPlan, updatePlan } from "@/lib/api/adminBilling";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const INTERVALS: Array<"month" | "year"> = ["month", "year"];

export function PlanForm({
  open,
  onClose,
  plan,
  onSaved,
  sources = [],
}: {
  open: boolean;
  onClose: () => void;
  plan: AdminPlan | null;
  onSaved: () => void;
  sources?: AdminPlan[];
}) {
  const { t } = useTranslation();
  const isEdit = plan != null;
  const initial = plan ?? sources[0];
  const [sourcePlanId, setSourcePlanId] = useState(initial?.id ?? "");
  const [targetNetworkId, setTargetNetworkId] = useState(plan?.targetNetworkId ?? "");
  const [limits, setLimits] = useState(initial?.limits);
  const [creditInterval, setCreditInterval] = useState<"month" | "year" | "none">(
    initial?.creditInterval ?? "none",
  );
  const readOnly = plan?.managedBy === "code";

  const [name, setName] = useState(initial?.name ?? "");
  const [priceCents, setPriceCents] = useState(String(initial?.priceCents ?? 0));
  const [currency, setCurrency] = useState(initial?.currency ?? "eur");
  const [interval, setInterval] = useState<"month" | "year">(initial?.interval ?? "month");
  const [creditsPerPeriod, setCreditsPerPeriod] = useState(String(initial?.creditsPerPeriod ?? 0));
  const [rolloverCap, setRolloverCap] = useState(String(initial?.rolloverCap ?? 0));
  const [features, setFeatures] = useState(initial?.features ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [highlighted, setHighlighted] = useState(plan?.highlighted ?? false);
  const [editorPro, setEditorPro] = useState(initial?.capabilities.editorPro ?? false);
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0));
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || readOnly || (!isEdit && !sourcePlanId)) return;
    setBusy(true);
    const body: PlanInput = {
      ...(!isEdit ? { sourcePlanId } : {}),
      targetNetworkId: targetNetworkId || null,
      limits,
      creditInterval,
      capabilities: { editorPro },
      name,
      interval,
      priceCents: Number(priceCents) || 0,
      currency,
      creditsPerPeriod: Number(creditsPerPeriod) || 0,
      rolloverCap: Number(rolloverCap) || 0,
      features,
      description,
      highlighted,
      sortOrder: Number(sortOrder) || 0,
      isActive: active,
    };
    try {
      const r = isEdit ? await updatePlan(plan.id, body) : await createPlan(body);
      if (r.ok) {
        toast.success(t("admin.billing.plans.saved"));
        onSaved();
        onClose();
      } else {
        toast.error(t("admin.billing.plans.saveFail"));
      }
    } catch {
      toast.error(t("admin.billing.plans.saveFail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {isEdit ? t("admin.billing.plans.edit") : t("admin.billing.plans.new")}
          </SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {readOnly && <p>{t("billing.catalog.managed")}</p>}
            {plan?.publicationStatus === "published" && !readOnly && (
              <p>{t("billing.catalog.newVersionHint")}</p>
            )}
            {!isEdit && (
              <FormField label={t("billing.catalog.source")}>
                <select
                  className="input"
                  value={sourcePlanId}
                  required
                  onChange={(event) => {
                    const source = sources.find((item) => item.id === event.target.value);
                    if (!source) return;
                    setSourcePlanId(source.id);
                    setLimits(source.limits);
                    setCreditInterval(source.creditInterval);
                    setName(source.name);
                    setPriceCents(String(source.priceCents));
                    setCurrency(source.currency);
                    setInterval(source.interval);
                    setCreditsPerPeriod(String(source.creditsPerPeriod));
                    setRolloverCap(String(source.rolloverCap));
                    setEditorPro(source.capabilities.editorPro);
                    setFeatures(source.features);
                    setDescription(source.description);
                  }}
                >
                  <option value="" disabled>
                    {t("billing.catalog.chooseSource")}
                  </option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} —{" "}
                      {t(
                        source.priceCents === 0
                          ? "billing.catalog.noBilling"
                          : `billing.catalog.billed_${source.interval}`,
                      )}{" "}
                      (v{source.version})
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <FormField label={t("billing.catalog.target")}>
                <Input
                  value={targetNetworkId}
                  onChange={(event) => setTargetNetworkId(event.target.value)}
                />
              </FormField>
              {limits &&
                (["resourcesPerServer", "servers", "collaborators"] as const).map((key) => (
                  <FormField
                    key={key}
                    label={t(`billing.catalog.${key}`)}
                    hint={t("billing.catalog.unlimitedHint")}
                  >
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={limits[key] ?? ""}
                      onChange={(event) =>
                        setLimits({
                          ...limits,
                          [key]: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </FormField>
                ))}
              <FormField label={t("billing.catalog.creditInterval")}>
                <select
                  className="input"
                  value={creditInterval}
                  onChange={(event) =>
                    setCreditInterval(event.target.value as typeof creditInterval)
                  }
                >
                  {(["none", "month", "year"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`billing.catalog.${value}`)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label={t("admin.billing.plans.form.name")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>

              <FormField label={t("admin.billing.plans.form.priceCents")}>
                <Input
                  type="number"
                  value={priceCents}
                  onChange={(e) => setPriceCents(e.target.value)}
                />
              </FormField>

              <FormField label={t("admin.billing.plans.form.currency")}>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </FormField>

              <FormField label={t("admin.billing.plans.form.interval")}>
                <select
                  className="input"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as "month" | "year")}
                >
                  {INTERVALS.map((iv) => (
                    <option key={iv} value={iv}>
                      {t(`billing.catalog.billed_${iv}`)}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label={t(`billing.catalog.creditAmount_${creditInterval}`)}>
                <Input
                  type="number"
                  value={creditsPerPeriod}
                  onChange={(e) => setCreditsPerPeriod(e.target.value)}
                />
              </FormField>

              <FormField label={t("admin.billing.plans.form.rolloverCap")}>
                <Input
                  type="number"
                  value={rolloverCap}
                  onChange={(e) => setRolloverCap(e.target.value)}
                />
              </FormField>

              <FormField
                label={t("admin.billing.plans.form.description")}
                hint={t("admin.billing.plans.form.descriptionHint")}
              >
                <Input
                  value={description}
                  maxLength={240}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>

              <FormField
                label={t("admin.billing.plans.form.features")}
                hint={t("admin.billing.plans.form.featuresHint")}
              >
                <textarea
                  className="input min-h-24 resize-y"
                  rows={4}
                  value={features}
                  onChange={(e) => setFeatures(e.target.value)}
                />
              </FormField>

              <FormField label={t("admin.billing.plans.form.sortOrder")}>
                <Input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </FormField>

              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={highlighted}
                  onChange={(e) => setHighlighted(e.target.checked)}
                  className="size-4 accent-[var(--brand)]"
                />
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {t("admin.billing.plans.form.highlighted")}
                </span>
              </label>

              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={editorPro}
                  onChange={(e) => setEditorPro(e.target.checked)}
                  className="size-4 accent-[var(--brand)]"
                />
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {t("admin.billing.plans.form.editorPro")}
                </span>
              </label>

              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="size-4 accent-[var(--brand)]"
                />
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {t("admin.billing.plans.form.active")}
                </span>
              </label>
            </fieldset>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("admin.billing.plans.cancel")}
              </Button>
              {!readOnly && (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || (!isEdit && !sourcePlanId)}
                >
                  {t("admin.billing.plans.save")}
                </Button>
              )}
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
