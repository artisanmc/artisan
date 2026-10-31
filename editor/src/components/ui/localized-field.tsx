import { cn } from "@/lib/cx";
import { Languages } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "./tooltip";

export interface LocalizedEditorProps {
  lang: string;
  /** This language's own text, "" when it has none. */
  value: string;
  /** The default language's text when this one has none: show it as a placeholder, never as the value. */
  fallback: string | undefined;
  /** Accessible name of the editor ("Title · fr"). */
  label: string;
}

export interface LocalizedFieldProps {
  label: string;
  /** The Project's languages, its default first. One language = a plain field. */
  langs: string[];
  /** The language the editor shows (the top bar's): edited when the field is folded. */
  activeLang: string;
  defaultLang: string;
  /** Each language's own text; absent or blank = not translated. */
  values: Record<string, string | undefined>;
  /** The control for one language: one when folded, one per language when unfolded. */
  renderEditor: (props: LocalizedEditorProps) => ReactNode;
  /** Beside the label, e.g. a reset button. */
  actions?: ReactNode;
  className?: string;
}

/** Languages missing a text the default language has: what the badge counts. */
export function missingLangs(
  langs: string[],
  defaultLang: string,
  values: Record<string, string | undefined>,
): string[] {
  if (!values[defaultLang]?.trim()) return [];
  return langs.filter((lang) => lang !== defaultLang && !values[lang]?.trim());
}

/**
 * A translatable text field (ADR `field-local-translations`). Folded, it edits the
 * active language, the default language's text showing as a placeholder when this one
 * has none. The translations toggle unfolds every language in place, each written
 * directly, without touching the active language (and so the preview). The badge
 * counts the missing translations. Unfolding is view state only, lost on unmount.
 */
function LocalizedField({
  label,
  langs,
  activeLang,
  defaultLang,
  values,
  renderEditor,
  actions,
  className,
}: LocalizedFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // An active language with no text anywhere yet is still one of the field's.
  const all = langs.includes(activeLang) ? langs : [...langs, activeLang];
  const multi = all.length > 1;
  const missing = missingLangs(all, defaultLang, values);
  const editor = (lang: string) =>
    renderEditor({
      lang,
      value: values[lang] ?? "",
      fallback:
        lang !== defaultLang && !values[lang] ? values[defaultLang] || undefined : undefined,
      label: multi ? `${label} · ${lang}` : label,
    });
  const order = [activeLang, ...all.filter((lang) => lang !== activeLang)];
  const toggleLabel = missing.length
    ? t("localizedField.toggleMissing", { count: missing.length, langs: missing.join(", ") })
    : t("localizedField.toggle");

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} data-testid="localized-field">
      <div className="flex min-h-6 items-center gap-2">
        <span className="field-label !mb-0">
          {label}
          {multi && !open && (
            <span className="mono ml-1.5 uppercase text-[var(--text-faint)]">{activeLang}</span>
          )}
        </span>
        <span className="flex-1" />
        {actions}
        {multi && (
          <Tooltip content={toggleLabel}>
            <button
              type="button"
              aria-label={toggleLabel}
              aria-pressed={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "relative flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors hover:bg-[var(--surface-hover)]",
                open ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--text-mut)]",
              )}
            >
              <Languages className="size-3.5" aria-hidden />
              {missing.length > 0 && (
                <span
                  data-testid="localized-field-missing"
                  className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-[var(--r-pill)] bg-[var(--warning)] px-1 text-[9px] font-bold leading-none text-[var(--surface)]"
                >
                  {missing.length}
                </span>
              )}
            </button>
          </Tooltip>
        )}
      </div>
      {multi && open ? (
        <div className="flex flex-col gap-2">
          {order.map((lang) => (
            <div key={lang} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-2">
              <span className="mono flex flex-col pt-2 text-[11px] uppercase leading-tight">
                <span
                  className={cn(
                    "font-semibold",
                    lang === activeLang ? "text-[var(--brand)]" : "text-[var(--text)]",
                    missing.includes(lang) && "text-[var(--warning)]",
                  )}
                >
                  {lang}
                </span>
                {lang === defaultLang && (
                  <span className="text-[9px] normal-case text-[var(--text-faint)]">
                    {t("localizedField.reference")}
                  </span>
                )}
              </span>
              {editor(lang)}
            </div>
          ))}
        </div>
      ) : (
        editor(activeLang)
      )}
    </div>
  );
}

export { LocalizedField };
