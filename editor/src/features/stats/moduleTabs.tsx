import { useModulesStore } from "@/state/modulesStore";
import { type FrontendModule, type ModuleStatsTab, listModules } from "@artisan/editor-sdk";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { PanelEmpty } from "./parts";
import type { StatsTab, StatsTabProps } from "./statsTabs";

/** A module tab's name in `lang`: its own string, else English, else the module's name. */
export function moduleTabLabel(mod: FrontendModule, tab: ModuleStatsTab, lang: string): string {
  if (typeof tab.label === "string") return tab.label;
  return tab.label[lang] ?? tab.label[lang.split("-")[0] ?? ""] ?? tab.label.en ?? mod.displayName;
}

/** A module's tab that threw keeps the rest of the space standing. */
class TabBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[stats] a module's tab failed", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The space's own tab around a module's component: the scope spelled out as the SDK gives it. */
export function moduleStatsTab(mod: FrontendModule, tab: ModuleStatsTab, lang: string): StatsTab {
  const Component = tab.component;
  function ModuleTab({ scope, focus, onFocus }: StatsTabProps) {
    const { t } = useTranslation();
    return (
      <TabBoundary
        key={mod.id}
        fallback={<PanelEmpty>{t("stats.moduleFailed", { module: mod.displayName })}</PanelEmpty>}
      >
        <Component
          serverId={scope.serverId}
          period={scope.period}
          player={scope.player}
          compare={scope.compare}
          lang={scope.lang}
          focus={focus}
          onFocus={onFocus}
        />
      </TabBoundary>
    );
  }
  return { id: `module:${mod.id}`, label: moduleTabLabel(mod, tab, lang), component: ModuleTab };
}

/** One tab per module mounted for this server that declares one (`FrontendModule.stats`). */
export function useModuleStatsTabs(): StatsTab[] {
  const mounted = useModulesStore((s) => s.mountedIds);
  const { i18n } = useTranslation();
  return React.useMemo(
    () =>
      listModules()
        .filter((m) => mounted.includes(m.id))
        .flatMap((m) => (m.stats ? [moduleStatsTab(m, m.stats, i18n.language)] : [])),
    [mounted, i18n.language],
  );
}
