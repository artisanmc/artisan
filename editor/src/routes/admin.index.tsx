import { AssistantConfigForm } from "@/features/admin/AssistantConfigForm";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/")({ component: AdminAiPage });

function AdminAiPage() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
        <h1
          className="display text-[32px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("admin.nav.ai")}
        </h1>
        <AssistantConfigForm />
      </div>
    </div>
  );
}
