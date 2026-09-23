import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { type AdminPlan, deactivatePlan, listPlans, updatePlan } from "@/lib/api/adminBilling";
import { formatCredits, formatMoney } from "@/lib/format";
import { CalendarClock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlanForm } from "./PlanForm";

export function BillingPlansTab() {
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<AdminPlan[] | null>(null); // null = loading
  const [editing, setEditing] = useState<AdminPlan | null | "new">(null);

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
    if (plan.isActive) {
      const res = await deactivatePlan(plan.id);
      if (res.ok) void refetch();
    } else {
      const res = await updatePlan(plan.id, { isActive: true });
      if (res.ok) void refetch();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
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
                <TD align="right">{formatCredits(p.creditsPerPeriod, i18n.language)}</TD>
                <TD>{p.interval}</TD>
                <TD>
                  <Badge variant={p.isActive ? "sage" : "brick"}>
                    {p.isActive
                      ? t("admin.billing.statusActive")
                      : t("admin.billing.statusInactive")}
                  </Badge>
                </TD>
                <TD align="right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      variant={p.isActive ? "outline" : "primary"}
                      size="sm"
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
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
