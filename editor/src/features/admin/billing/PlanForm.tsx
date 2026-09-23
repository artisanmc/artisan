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
}: {
  open: boolean;
  onClose: () => void;
  plan: AdminPlan | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = plan != null;

  const [name, setName] = useState(plan?.name ?? "");
  const [priceCents, setPriceCents] = useState(String(plan?.priceCents ?? 0));
  const [currency, setCurrency] = useState(plan?.currency ?? "usd");
  const [interval, setInterval] = useState<"month" | "year">(plan?.interval ?? "month");
  const [creditsPerPeriod, setCreditsPerPeriod] = useState(String(plan?.creditsPerPeriod ?? 0));
  const [rolloverCap, setRolloverCap] = useState(String(plan?.rolloverCap ?? 0));
  const [features, setFeatures] = useState(plan?.features ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [highlighted, setHighlighted] = useState(plan?.highlighted ?? false);
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0));
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    const body: PlanInput = {
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
                    {iv}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={t("admin.billing.plans.form.creditsPerPeriod")}>
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
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="text-[13px] font-medium text-[var(--text)]">
                {t("admin.billing.plans.form.active")}
              </span>
            </label>

            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("admin.billing.plans.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t("admin.billing.plans.save")}
              </Button>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
