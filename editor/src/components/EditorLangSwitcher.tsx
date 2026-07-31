import { SUPPORTED_LANGS, type SupportedLang } from "@/i18n";
import { useUiStore } from "@/state/uiStore";

const LABELS: Record<SupportedLang, string> = {
  en: "English",
  fr: "Français",
};

/**
 * Switches the editor's UI language (not the project content language).
 * Rendered as a regular labelled select-style dropdown — the current value
 * is visible in the trigger, no need to open the menu to know the current
 * language.
 */
export function EditorLangSwitcher() {
  const editorLang = useUiStore((s) => s.editorLang);
  const setEditorLang = useUiStore((s) => s.setEditorLang);

  return (
    <select
      data-testid="editor-lang-switcher"
      value={editorLang}
      onChange={(e) => setEditorLang(e.target.value as SupportedLang)}
      className="select max-w-[200px]"
    >
      {SUPPORTED_LANGS.map((lang) => (
        <option key={lang} value={lang}>
          {LABELS[lang as SupportedLang] ?? lang}
        </option>
      ))}
    </select>
  );
}
