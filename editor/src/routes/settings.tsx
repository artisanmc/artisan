import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppearanceSection } from "@/features/settings/AppearanceSection";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

export function SettingsRoute() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full">
      <nav
        aria-label="Settings sections"
        className="w-56 border-r border-zinc-800 bg-zinc-950 p-3"
      >
        <ul className="flex flex-col gap-1">
          <li>
            <button
              type="button"
              className="block w-full rounded bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-100"
            >
              {t("settings.appearance.title")}
            </button>
          </li>
        </ul>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <AppearanceSection />
      </main>
    </div>
  );
}

export default SettingsRoute;
