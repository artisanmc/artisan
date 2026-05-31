import { useTranslation } from "react-i18next";
import { EditorLangSwitcher } from "@/components/EditorLangSwitcher";

export function AppearanceSection() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1
          className="display text-[32px] tracking-tight text-[var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("settings.appearance.title")}
        </h1>
        <p className="text-[13px] text-[var(--ink-mut)]">
          {t("settingsPage.appearanceHelp")}
        </p>
      </header>

      <div className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("settings.appearance.editorLanguage")}</span>
          <EditorLangSwitcher />
        </div>
      </div>
    </section>
  );
}
