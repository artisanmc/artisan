import { EditorLangSwitcher } from "@/components/EditorLangSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { useTranslation } from "react-i18next";

export function AppearanceSection() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("settings.appearance.theme")}</span>
          <ThemeSwitcher />
        </div>
        <div className="rule" />
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("settings.appearance.editorLanguage")}</span>
          <EditorLangSwitcher />
        </div>
      </div>
    </section>
  );
}
