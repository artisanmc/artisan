import { DesignSystemPage } from "@/features/design-system/DesignSystemPage";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/design")({ component: DesignPage });

function DesignPage() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
        <h1
          className="display text-[32px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("adminDesign.title")}
        </h1>
        <p className="max-w-2xl text-[13.5px] text-[var(--text-mut)]">{t("adminDesign.intro")}</p>
        <DesignSystemPage />
      </div>
    </div>
  );
}
