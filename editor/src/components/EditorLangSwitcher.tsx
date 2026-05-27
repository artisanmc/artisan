import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGS, type SupportedLang } from "@/i18n";
import { useUiStore } from "@/state/uiStore";

/**
 * Switches the editor's UI language (not the pack content language).
 * A user translating their pack into a third language keeps their editor
 * in their own tongue.
 */
export function EditorLangSwitcher() {
  const editorLang = useUiStore((s) => s.editorLang);
  const setEditorLang = useUiStore((s) => s.setEditorLang);
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="editor-lang-switcher"
          title={t("editorLangSwitcher.title")}
          className="flex h-9 w-9 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Globe className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200"
      >
        {SUPPORTED_LANGS.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onSelect={() => setEditorLang(lang as SupportedLang)}
            className="flex cursor-pointer items-center gap-2 focus:bg-zinc-800"
          >
            <span
              className={`font-mono uppercase ${lang === editorLang ? "text-emerald-300" : ""}`}
            >
              {lang}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
