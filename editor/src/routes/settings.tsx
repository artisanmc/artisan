import { AppearanceSection } from "@/features/settings/AppearanceSection";
import { EditorAddressSection } from "@/features/settings/EditorAddressSection";
import { useAuthStore } from "@/state/authStore";
import { createFileRoute } from "@tanstack/react-router";
import { Globe, Palette } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

type Section = "appearance" | "address";

export function SettingsRoute() {
  const { t } = useTranslation();
  // The editor's address is the hub's, for those who may configure it.
  const canConfigure = useAuthStore(
    (s) => s.currentUser?.permissions?.includes("artisan.editor.config") ?? false,
  );
  const [section, setSection] = useState<Section>(() =>
    typeof window !== "undefined" && window.location.hash === "#address" ? "address" : "appearance",
  );
  const current: Section = section === "address" && canConfigure ? "address" : "appearance";
  const sections: { id: Section; icon: typeof Palette; label: string }[] = [
    { id: "appearance", icon: Palette, label: t("settings.appearance.title") },
    ...(canConfigure
      ? [{ id: "address" as const, icon: Globe, label: t("editorAddress.title") }]
      : []),
  ];
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 py-10">
        <header className="flex flex-col gap-1.5">
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {current === "address" ? t("editorAddress.title") : t("settings.appearance.title")}
          </h1>
          <p className="text-[13px] text-[var(--text-mut)]">
            {current === "address" ? t("editorAddress.help") : t("settingsPage.appearanceHelp")}
          </p>
        </header>
        <div className="flex flex-col gap-4 lg:flex-row">
          <nav aria-label="Settings sections" className="card shrink-0 p-3 lg:w-[224px]">
            <div className="section-label px-2 pt-1 pb-3">{t("settingsPage.eyebrowSettings")}</div>
            <ul className="flex flex-col gap-0.5">
              {sections.map(({ id, icon: Icon, label }) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-current={current === id ? "page" : undefined}
                    onClick={() => setSection(id)}
                    className={
                      current === id
                        ? "flex w-full items-center gap-2.5 rounded-[10px] bg-[var(--brand-soft)] px-2.5 py-2 text-left text-[13px] font-semibold text-white"
                        : "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-[var(--text-mut)] hover:bg-[var(--surface-hover)]"
                    }
                  >
                    <Icon className="size-[15px] shrink-0 text-[var(--brand)]" />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <main className="card flex-1 p-6 md:p-8">
            {current === "address" ? <EditorAddressSection /> : <AppearanceSection />}
          </main>
        </div>
      </div>
    </div>
  );
}

export default SettingsRoute;
