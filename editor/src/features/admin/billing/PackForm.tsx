import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type AdminPack, type PackInput, createPack, updatePack } from "@/lib/api/adminBilling";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function PackForm({
  open,
  onClose,
  pack,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  pack: AdminPack | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = pack != null;

  const [name, setName] = useState(pack?.name ?? "");
  const [priceCents, setPriceCents] = useState(String(pack?.priceCents ?? 0));
  const [currency, setCurrency] = useState(pack?.currency ?? "usd");
  const [credits, setCredits] = useState(String(pack?.credits ?? 0));
  const [bonusPct, setBonusPct] = useState(String(pack?.bonusPct ?? 0));
  const [sortOrder, setSortOrder] = useState(String(pack?.sortOrder ?? 0));
  const [active, setActive] = useState(pack?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    const body: PackInput = {
      name,
      priceCents: Number(priceCents) || 0,
      currency,
      credits: Number(credits) || 0,
      bonusPct: Number(bonusPct) || 0,
      sortOrder: Number(sortOrder) || 0,
      isActive: active,
    };
    const r = isEdit ? await updatePack(pack.id, body) : await createPack(body);
    setBusy(false);
    if (r.ok) {
      toast.success(t("admin.billing.packs.saved"));
      onSaved();
      onClose();
    } else {
      toast.error(t("admin.billing.packs.saveFail"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {isEdit ? t("admin.billing.packs.edit") : t("admin.billing.packs.new")}
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
            <FormField label={t("admin.billing.packs.form.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>

            <FormField label={t("admin.billing.packs.form.priceCents")}>
              <Input
                type="number"
                value={priceCents}
                onChange={(e) => setPriceCents(e.target.value)}
              />
            </FormField>

            <FormField label={t("admin.billing.packs.form.currency")}>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </FormField>

            <FormField label={t("admin.billing.packs.form.credits")}>
              <Input type="number" value={credits} onChange={(e) => setCredits(e.target.value)} />
            </FormField>

            <FormField label={t("admin.billing.packs.form.bonusPct")}>
              <Input
                type="number"
                value={bonusPct}
                onChange={(e) => setBonusPct(e.target.value)}
              />
            </FormField>

            <FormField label={t("admin.billing.packs.form.sortOrder")}>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </FormField>

            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="text-[13px] font-medium text-[var(--text)]">
                {t("admin.billing.packs.form.active")}
              </span>
            </label>

            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("admin.billing.packs.cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t("admin.billing.packs.save")}
              </Button>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
