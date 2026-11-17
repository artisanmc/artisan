import type { FrontendModule } from "@artisan/editor-sdk";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { moduleStatsTab, moduleTabLabel } from "./moduleTabs";
import type { StatsScope } from "./statsScope";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => `${key}:${o?.module ?? ""}`,
    i18n: { language: "fr" },
  }),
}));

const mod = { id: "msquests", displayName: "Quests" } as FrontendModule;
const scope: StatsScope = {
  serverId: "hub-1",
  period: { from: 0, to: 86400, by: "hour", previous: { from: -86400, to: 0 } },
  player: "p1",
  compare: true,
  lang: "fr",
};

describe("a module's statistics tab", () => {
  it("is named in the interface language, then English, then after its module", () => {
    const component = () => null;
    expect(moduleTabLabel(mod, { label: "Quêtes", component }, "en")).toBe("Quêtes");
    expect(moduleTabLabel(mod, { label: { en: "Quests", fr: "Quêtes" }, component }, "fr-FR")).toBe(
      "Quêtes",
    );
    expect(moduleTabLabel(mod, { label: { en: "Quests" }, component }, "de")).toBe("Quests");
    expect(moduleTabLabel(mod, { label: {}, component }, "de")).toBe("Quests");
  });

  it("gets the space's scope and focus as the SDK spells them", () => {
    const seen: unknown[] = [];
    const onFocus = vi.fn();
    const tab = moduleStatsTab(
      mod,
      {
        label: "Quêtes",
        component: (props) => {
          seen.push(props);
          return (
            <button type="button" onClick={() => props.onFocus("daily")}>
              open
            </button>
          );
        },
      },
      "fr",
    );
    expect(tab.id).toBe("module:msquests");
    const Tab = tab.component;
    render(
      <Tab scope={scope} focus="weekly" onFocus={onFocus} known={{ commands: [], menus: [] }} />,
    );
    expect(seen[0]).toMatchObject({
      serverId: "hub-1",
      period: scope.period,
      player: "p1",
      compare: true,
      lang: "fr",
      focus: "weekly",
    });
    screen.getByText("open").click();
    expect(onFocus).toHaveBeenCalledWith("daily");
  });

  it("that throws leaves a notice in its place", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const tab = moduleStatsTab(
      mod,
      {
        label: "Quêtes",
        component: () => {
          throw new Error("boom");
        },
      },
      "fr",
    );
    const Tab = tab.component;
    render(
      <Tab
        scope={scope}
        focus={undefined}
        onFocus={() => {}}
        known={{ commands: [], menus: [] }}
      />,
    );
    expect(screen.getByText("stats.moduleFailed:Quests")).toBeTruthy();
    quiet.mockRestore();
  });
});
