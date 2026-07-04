import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { grantCredits } from "@/lib/api/adminBilling";
import { formatCredits } from "@/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function BillingGrantTab() {
  const { t, i18n } = useTranslation();
  const [networkId, setNetworkId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await grantCredits(networkId, Number(amount), note || undefined);
    setBusy(false);
    if (res.ok) {
      setMessage({
        kind: "ok",
        text: t("admin.billing.grant.ok", { balance: formatCredits(res.data.balance, i18n.language) }),
      });
      setNetworkId("");
      setAmount("");
      setNote("");
    } else {
      const key =
        res.error === "invalid_amount"
          ? "admin.billing.grant.invalidAmount"
          : res.error === "network_not_found"
            ? "admin.billing.grant.networkNotFound"
            : "admin.billing.grant.fail";
      setMessage({ kind: "error", text: t(key) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[18px] font-semibold text-[var(--text)]">{t("admin.billing.grant.title")}</h2>
        <p className="text-[13.5px] text-[var(--text-mut)]">{t("admin.billing.grant.subtitle")}</p>
      </div>

      <div className="card flex max-w-md flex-col gap-4 p-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField label={t("admin.billing.grant.networkId")}>
            <Input value={networkId} onChange={(e) => setNetworkId(e.target.value)} />
          </FormField>

          <FormField label={t("admin.billing.grant.amount")}>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>

          <FormField label={t("admin.billing.grant.note")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>

          <Button type="submit" variant="primary" disabled={busy}>
            {t("admin.billing.grant.submit")}
          </Button>
        </form>

        {message != null && (
          <p
            className={
              message.kind === "ok" ? "text-[13px] text-[var(--success)]" : "text-[13px] text-[var(--danger)]"
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
