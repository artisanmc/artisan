import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/ai/usage")({ component: AdminAiUsagePage });

// Placeholder — full analytics UI (StatCard/HBar, adminAiUsage client) lands in a later task.
function AdminAiUsagePage() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
        <h1
          className="display text-[32px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("admin.ai.usage.title")}
        </h1>
        <p className="text-[13.5px] text-[var(--text-mut)]">{t("admin.ai.usage.subtitle")}</p>
      </div>
    </div>
  );
}
