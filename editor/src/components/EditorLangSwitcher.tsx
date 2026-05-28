import { SUPPORTED_LANGS, type SupportedLang } from "@/i18n";
import { useUiStore } from "@/state/uiStore";

const LABELS: Record<SupportedLang, string> = {
  en: "English",
  fr: "Français",
};

/**
 * Switches the editor's UI language (not the pack content language).
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
      className="appearance-none rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 pr-8 text-sm text-zinc-100 hover:border-zinc-600 focus:border-zinc-500 focus:outline-none"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.5rem center",
        backgroundSize: "12px",
      }}
    >
      {SUPPORTED_LANGS.map((lang) => (
        <option key={lang} value={lang}>
          {LABELS[lang as SupportedLang] ?? lang}
        </option>
      ))}
    </select>
  );
}
