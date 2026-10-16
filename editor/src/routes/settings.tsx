import { AppearanceSection } from "@/features/settings/AppearanceSection";
import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

export function SettingsRoute() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-10">
        <header className="flex flex-col gap-1.5">
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("settings.appearance.title")}
          </h1>
          <p className="text-[13px] text-[var(--text-mut)]">{t("settingsPage.appearanceHelp")}</p>
        </header>
        <div className="flex flex-col gap-4 lg:flex-row">
          <nav aria-label="Settings sections" className="card shrink-0 p-3 lg:w-[224px]">
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
          <main className="card flex-1 p-6 md:p-8">
            <AppearanceSection />
          </main>
        </div>
      </div>
    </div>
  );
}

export default SettingsRoute;
