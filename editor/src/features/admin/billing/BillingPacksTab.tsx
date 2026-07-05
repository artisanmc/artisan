import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { type AdminPack, deactivatePack, listPacks, updatePack } from "@/lib/api/adminBilling";
import { formatCredits, formatMoney } from "@/lib/format";
import { Package } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PackForm } from "./PackForm";

export function BillingPacksTab() {
  const { t, i18n } = useTranslation();
  const [packs, setPacks] = useState<AdminPack[] | null>(null); // null = loading
  const [editing, setEditing] = useState<AdminPack | null | "new">(null);

  async function refetch() {
    try {
      const p = await listPacks();
      setPacks(p ?? []);
    } catch (e) {
      console.warn("[admin-billing] fetch failed:", e);
      setPacks([]);
    }
  }

  useEffect(() => {
    void refetch();
  }, []);

  const sorted = [...(packs ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  async function handleToggleActive(pack: AdminPack) {
    if (pack.isActive) {
      const res = await deactivatePack(pack.id);
      if (res.ok) void refetch();
    } else {
      const res = await updatePack(pack.id, { isActive: true });
      if (res.ok) void refetch();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button type="button" variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("admin.billing.packs.new")}
        </Button>
      </div>

      {packs && packs.length === 0 ? (
        <EmptyState icon={Package} title={t("admin.billing.packs.empty")} className="h-auto py-16" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("admin.billing.packs.columns.name")}</TH>
              <TH align="right">{t("admin.billing.packs.columns.price")}</TH>
              <TH align="right">{t("admin.billing.packs.columns.credits")}</TH>
              <TH align="right">{t("admin.billing.packs.columns.bonus")}</TH>
              <TH>{t("admin.billing.packs.columns.status")}</TH>
              <TH align="right" />
            </TR>
          </THead>
          <TBody>
            {sorted.map((p) => (
              <TR key={p.id}>
                <TD>
                  <span className="font-medium text-[var(--text)]">{p.name}</span>
                </TD>
                <TD align="right">{formatMoney(p.priceCents, p.currency, i18n.language)}</TD>
                <TD align="right">{formatCredits(p.credits, i18n.language)}</TD>
                <TD align="right">{p.bonusPct}%</TD>
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
                        ? t("admin.billing.packs.deactivate")
                        : t("admin.billing.packs.activate")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(p)}>
                      {t("admin.billing.packs.edit")}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing !== null && (
        <PackForm
          open
          onClose={() => setEditing(null)}
          pack={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
