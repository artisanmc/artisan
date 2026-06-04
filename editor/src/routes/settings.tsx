import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import { AppearanceSection } from "@/features/settings/AppearanceSection";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

export function SettingsRoute() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full bg-[var(--surface)]">
      <nav
        aria-label="Settings sections"
        className="w-[224px] shrink-0 border-r border-[var(--border-soft)] bg-[var(--surface)] p-3"
      >
        <div className="px-2 pt-1 pb-3 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
          {t("settingsPage.eyebrowSettings")}
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-[10px] bg-[var(--brand-soft)] px-2.5 py-2 text-left text-[13px] font-semibold text-white"
            >
              <Palette className="size-[15px] shrink-0 text-[var(--brand)]" />
              {t("settings.appearance.title")}
            </button>
          </li>
        </ul>
      </nav>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">
          <AppearanceSection />
        </div>
      </main>
    </div>
  );
}

export default SettingsRoute;
