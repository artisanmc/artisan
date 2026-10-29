import { McpAppsSection } from "@/features/mcp/McpAppsSection";
import { AppearanceSection } from "@/features/settings/AppearanceSection";
import { AssistantSettingsSection } from "@/features/settings/AssistantSettingsSection";
import { EditorAddressSection } from "@/features/settings/EditorAddressSection";
import { EditorSessionsSection } from "@/features/settings/EditorSessionsSection";
import { useAuthStore } from "@/state/authStore";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Globe, Palette, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

type Section = "appearance" | "address" | "sessions" | "ai" | "assistant";

const TITLES: Record<Section, [title: string, help: string]> = {
  appearance: ["settings.appearance.title", "settingsPage.appearanceHelp"],
  ai: ["mcp.apps.title", "mcp.apps.help"],
  address: ["editorAddress.title", "editorAddress.help"],
  sessions: ["editorSessions.title", "editorSessions.help"],
  assistant: ["ai.settings.title", "ai.settings.help"],
};

export function SettingsRoute() {
  const { t } = useTranslation();
  // The editor's address and its sessions are the hub's, for those who may configure it.
  const canConfigure = useAuthStore(
    (s) => s.currentUser?.permissions?.includes("artisan.editor.config") ?? false,
  );
  const [section, setSection] = useState<Section>(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    return hash === "#address"
      ? "address"
      : hash === "#sessions"
        ? "sessions"
        : hash === "#ai"
          ? "ai"
          : hash === "#assistant"
            ? "assistant"
            : "appearance";
  });
  const current: Section =
    (section === "address" || section === "sessions" || section === "assistant") && !canConfigure
      ? "appearance"
      : section;
  const sections: { id: Section; icon: typeof Palette; label: string }[] = [
    { id: "appearance", icon: Palette, label: t("settings.appearance.title") },
    { id: "ai", icon: Bot, label: t("mcp.apps.title") },
    ...(canConfigure
      ? [
          { id: "address" as const, icon: Globe, label: t("editorAddress.title") },
          { id: "sessions" as const, icon: Users, label: t("editorSessions.title") },
          { id: "assistant" as const, icon: Sparkles, label: t("ai.settings.title") },
        ]
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
            {t(TITLES[current][0])}
          </h1>
          <p className="text-[13px] text-[var(--text-mut)]">{t(TITLES[current][1])}</p>
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
            {current === "address" ? (
              <EditorAddressSection />
            ) : current === "sessions" ? (
              <EditorSessionsSection />
            ) : current === "assistant" ? (
              <AssistantSettingsSection />
            ) : current === "ai" ? (
              <McpAppsSection />
            ) : (
              <AppearanceSection />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default SettingsRoute;
