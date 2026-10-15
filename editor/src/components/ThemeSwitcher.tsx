import { useThemeStore, type Theme } from "@/state/themeStore";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";

/**
 * Binary segmented-control: [☾ Dark] [☀ Light]
 * No "system" option — OS preference is the implicit default until the user
 * makes a choice, which persists. No CSS transition on swap.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const options: { value: Theme; label: string; Icon: typeof Moon }[] = [
    { value: "dark", label: t("settings.appearance.themeDark"), Icon: Moon },
    { value: "light", label: t("settings.appearance.themeLight"), Icon: Sun },
  ];

  return (
    <fieldset
      aria-label={t("settings.appearance.theme")}
      className="inline-flex rounded-[var(--r-md)] border border-[var(--border)] overflow-hidden"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          data-testid={`theme-option-${value}`}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={[
            "flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold transition-colors",
            theme === value
              ? "bg-[var(--brand-soft)] text-[var(--brand)]"
              : "bg-transparent text-[var(--text-mut)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]",
          ].join(" ")}
        >
          <Icon className="size-[14px]" />
          {label}
        </button>
      ))}
    </fieldset>
  );
}
