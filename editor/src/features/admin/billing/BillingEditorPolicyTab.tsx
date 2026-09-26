import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { getEditorCommercialPolicy, updateEditorCommercialPolicy, type EditorCommercialPolicy } from "@/lib/api/adminBilling";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function BillingEditorPolicyTab() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<EditorCommercialPolicy | null>(null);
  const [quota, setQuota] = useState("10");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getEditorCommercialPolicy().then((policy) => {
      if (!policy) return;
      setSaved(policy);
      setQuota(String(policy.quota));
      setEnabled(policy.enforcementEnabled);
    });
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(quota);
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000) return;
    setBusy(true);
    try {
      const result = await updateEditorCommercialPolicy({ quota: value, enforcementEnabled: enabled });
      if (!result.ok) throw new Error(result.error);
      setSaved(result.data);
      toast.success(t("admin.billing.editor.saved"));
    } catch {
      toast.error(t("admin.billing.editor.failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="max-w-2xl p-6">
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">{t("admin.billing.editor.title")}</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t("admin.billing.editor.help")}</p>
        </div>
        <FormField label={t("admin.billing.editor.quota")}>
          <Input type="number" min={0} max={100000} required value={quota} onChange={(event) => setQuota(event.target.value)} />
        </FormField>
        {saved && Number(quota) < saved.quota && <p role="alert" className="text-sm text-[var(--text-muted)]">{t("admin.billing.editor.lowering")}</p>}
        <label className="flex items-start gap-3 text-sm text-[var(--text)]">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-1 size-4 accent-[var(--brand)]" />
          <span>{t("admin.billing.editor.enforce")}</span>
        </label>
        <Button type="submit" variant="primary" disabled={busy || !saved}>{t("admin.billing.editor.save")}</Button>
      </form>
    </Card>
  );
}
