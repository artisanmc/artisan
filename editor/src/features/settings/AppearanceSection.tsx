import { useTranslation } from "react-i18next";
import { EditorLangSwitcher } from "@/components/EditorLangSwitcher";

export function AppearanceSection() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">{t("settings.appearance.title")}</h2>
      <div className="flex items-center gap-3">
        <label className="text-sm text-zinc-300">{t("settings.appearance.editorLanguage")}</label>
        <EditorLangSwitcher />
      </div>
    </section>
  );
}
