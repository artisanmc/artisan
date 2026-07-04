import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { BillingGrantTab } from "./BillingGrantTab";
import { BillingPacksTab } from "./BillingPacksTab";
import { BillingPlansTab } from "./BillingPlansTab";
import { BillingSalesTab } from "./BillingSalesTab";

export function BillingPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <h1
        className="display text-[32px] tracking-tight text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("admin.billing.title")}
      </h1>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">{t("admin.billing.tabs.sales")}</TabsTrigger>
          <TabsTrigger value="packs">{t("admin.billing.tabs.packs")}</TabsTrigger>
          <TabsTrigger value="plans">{t("admin.billing.tabs.plans")}</TabsTrigger>
          <TabsTrigger value="grant">{t("admin.billing.tabs.grant")}</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <BillingSalesTab />
        </TabsContent>
        <TabsContent value="packs" className="mt-4">
          <BillingPacksTab />
        </TabsContent>
        <TabsContent value="plans" className="mt-4">
          <BillingPlansTab />
        </TabsContent>
        <TabsContent value="grant" className="mt-4">
          <BillingGrantTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
