import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  type AdminPlan,
  deactivatePlan,
  listPlans,
  provisionPlans,
  publishPlan,
  updatePlan,
} from "@/lib/api/adminBilling";
import { formatCredits, formatMoney } from "@/lib/format";
import { CalendarClock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PlanForm } from "./PlanForm";

export function BillingPlansTab() {
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<AdminPlan[] | null>(null); // null = loading
  const [editing, setEditing] = useState<AdminPlan | null | "new">(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const p = await listPlans();
      setPlans(p ?? []);
    } catch (e) {
      console.warn("[admin-billing] fetch failed:", e);
      setPlans([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const sorted = [...(plans ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  async function handleToggleActive(plan: AdminPlan) {
    if (busy || plan.managedBy === "code") return;
    setBusy(true);
    try {
      if (plan.isActive) {
        const res = await deactivatePlan(plan.id);
        if (!res.ok) throw new Error(res.error);
        await refetch();
      } else {
        const res = await updatePlan(plan.id, { isActive: true });
        if (!res.ok) throw new Error(res.error);
        await refetch();
      }
    } catch {
      toast.error(t("admin.billing.plans.saveFail"));
    } finally {
      setBusy(false);
    }
  }

  async function publish(plan: AdminPlan) {
    setBusy(true);
    try {
      const result = await publishPlan(plan.id);
      if (!result.ok) throw new Error(result.error);
      await refetch();
    } catch {
      toast.error(t("admin.billing.plans.saveFail"));
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    setBusy(true);
    try {
      const result = await provisionPlans();
      if (!result.ok || result.data.results.some((item) => item.status === "error"))
        throw new Error("provision_failed");
      toast.info(
        t(
          result.data.results.some((item) => item.status === "unavailable")
            ? "billing.catalog.paymentUnavailable"
            : "billing.catalog.provisioned",
        ),
      );
      await refetch();
    } catch {
      toast.error(t("admin.billing.plans.saveFail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void provision()}>
          {t("billing.catalog.provision")}
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("admin.billing.plans.new")}
        </Button>
      </div>

      {plans && plans.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t("admin.billing.plans.empty")}
          className="h-auto py-16"
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("admin.billing.plans.columns.name")}</TH>
              <TH align="right">{t("admin.billing.plans.columns.price")}</TH>
              <TH align="right">{t("admin.billing.plans.columns.credits")}</TH>
              <TH>{t("admin.billing.plans.columns.interval")}</TH>
              <TH>{t("admin.billing.plans.columns.status")}</TH>
              <TH align="right" />
            </TR>
          </THead>
          <TBody>
            {sorted.map((p) => (
              <TR key={p.id}>
                <TD>
                  <span className="font-medium text-[var(--text)]">{p.name}</span>
                  {p.key === "free" && (
                    <p className="text-xs text-[var(--text-mut)]">
                      {t("billing.catalog.defaultNetworkPlan")}
                    </p>
                  )}
                  <Badge className="ml-2">
                    {p.managedBy === "code"
                      ? t("billing.catalog.managed")
                      : t("billing.catalog.custom")}{" "}
                    · v{p.version}
                  </Badge>
                  {p.targetNetworkId && (
                    <p className="text-xs text-[var(--text-mut)]">{p.targetNetworkId}</p>
                  )}
                  {p.highlighted && (
                    <Badge variant="sage" className="ml-2">
                      {t("admin.billing.plans.highlighted")}
                    </Badge>
                  )}
                  {p.description && (
                    <p className="mt-1 text-xs text-[var(--text-mut)]">{p.description}</p>
                  )}
                </TD>
                <TD align="right">{formatMoney(p.priceCents, p.currency, i18n.language)}</TD>
                <TD align="right">
                  {p.creditInterval === "none"
                    ? t("billing.catalog.none")
                    : t(`billing.catalog.credits_${p.creditInterval}`, {
                        credits: formatCredits(p.creditsPerPeriod, i18n.language),
                      })}
                </TD>
                <TD>
                  {t(
                    p.priceCents === 0
                      ? "billing.catalog.noBilling"
                      : `billing.catalog.billed_${p.interval}`,
                  )}
                </TD>
                <TD>
                  <Badge>
                    {t(
                      p.publicationStatus === "draft"
                        ? "billing.catalog.draft"
                        : "billing.catalog.published",
                    )}
                  </Badge>
                  <p className="text-xs text-[var(--text-mut)]">
                    {t(`billing.catalog.payment_${p.stripeProvisioningStatus}`)}
                  </p>
                  <Badge variant={p.isActive ? "sage" : "brick"}>
                    {p.isActive
                      ? t("admin.billing.statusActive")
                      : t("admin.billing.statusInactive")}
                  </Badge>
                </TD>
                <TD align="right">
                  {p.managedBy !== "code" && (
                    <div className="flex justify-end gap-1.5">
                      {p.publicationStatus === "draft" && (
                        <Button
                          size="sm"
                          disabled={busy || !p.targetNetworkId}
                          onClick={() => void publish(p)}
                        >
                          {t("billing.catalog.publish")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant={p.isActive ? "outline" : "primary"}
                        size="sm"
                        disabled={busy}
                        onClick={() => handleToggleActive(p)}
                      >
                        {p.isActive
                          ? t("admin.billing.plans.deactivate")
                          : t("admin.billing.plans.activate")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        {t("admin.billing.plans.edit")}
                      </Button>
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing !== null && (
        <PlanForm
          open
          onClose={() => setEditing(null)}
          plan={editing === "new" ? null : editing}
          sources={(plans ?? []).filter((plan) => plan.managedBy === "code")}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
