/** What the module home says of a settings screen, read from the Project's copy of its file. */
import { injectDeclaredModels } from "@/domain/dataModels";
import type { Project, ProjectId } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { describe, expect, it } from "vitest";
import { PREVIEW_LINES, screenPreview } from "./screenPreview";

const base = "plugins/Artisan/projects/daily";

function daily(files: Record<string, string>): Project {
  return projectFromFiles("daily" as ProjectId, {
    [`${base}/manifest.yaml`]: "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr, en]\n",
    ...Object.fromEntries(Object.entries(files).map(([p, c]) => [`${base}/${p}`, c])),
  });
}

const settingsYaml = [
  'reset_time: "00:00"',
  'auto_claim: "off"',
  "min_playtime_minutes: 10",
  "join_reminder: true",
  "freeze:",
  "  earn_every: 7",
  "",
].join("\n");

const rewardsYaml = [
  "cycle_length: 28",
  "default_day:",
  "  icon: { material: BREAD }",
  "days:",
  "  7: { icon: { material: IRON_INGOT } }",
  "  14: { icon: { material: GOLD_INGOT } }",
  "milestones:",
  "  - { at: 30 }",
  "",
].join("\n");

const settingsScreen = { id: "daily:settings", projectId: "daily", table: "data/settings" };

describe("screenPreview", () => {
  it("labels the values with the declared model named like the screen", () => {
    const project = daily({ "data/settings.yaml": settingsYaml });
    injectDeclaredModels(project, [
      {
        id: "daily:settings",
        fields: [
          { name: "reset_time", type: { kind: "string" }, label: "Reset time" },
          {
            name: "auto_claim",
            type: { kind: "enum", values: ["off", "on"] },
            label: "Auto-claim",
          },
          { name: "min_playtime_minutes", type: { kind: "integer" }, label: "Playtime" },
          { name: "join_reminder", type: { kind: "boolean" }, label: "Remind at join" },
          { name: "freeze", type: { kind: "object", fields: [] }, label: "Freezes" },
        ],
      },
    ]);
    expect(screenPreview(project, settingsScreen).lines).toEqual([
      { label: "Reset time", value: "00:00" },
      { label: "Auto-claim", value: "off" },
      { label: "Playtime", value: 10 },
      { label: "Remind at join", value: true },
    ]);
  });

  it("counts lists and maps, leaves out objects, and falls back on the field's default", () => {
    const project = daily({ "data/rewards.yaml": rewardsYaml });
    injectDeclaredModels(project, [
      {
        id: "daily:rewards",
        fields: [
          { name: "cycle_length", type: { kind: "integer" }, label: "Cycle length" },
          { name: "days", type: { kind: "map", of: { kind: "item" } }, label: "Rewards by day" },
          { name: "default_day", type: { kind: "object", fields: [] }, label: "Other days" },
          {
            name: "with_default_day",
            type: { kind: "boolean" },
            label: "Also pay",
            default: false,
          },
          { name: "milestones", type: { kind: "list", of: { kind: "item" } }, label: "Milestones" },
        ],
      },
    ]);
    const screen = { id: "daily:rewards", projectId: "daily", table: "data/rewards" };
    expect(screenPreview(project, screen).lines).toEqual([
      { label: "Cycle length", value: 28 },
      { label: "Rewards by day", value: 2, count: true },
      { label: "Also pay", value: false },
      { label: "Milestones", value: 1, count: true },
    ]);
  });

  it("writes the keys as words when no model is known", () => {
    const project = daily({ "data/settings.yaml": settingsYaml });
    const { lines } = screenPreview(project, settingsScreen);
    expect(lines.map((l) => l.label)).toEqual([
      "Reset time",
      "Auto claim",
      "Min playtime minutes",
      "Join reminder",
    ]);
    expect(lines).toHaveLength(PREVIEW_LINES);
  });

  it("says nothing of a screen of another folder or of a file the Project does not hold", () => {
    const project = daily({ "data/settings.yaml": settingsYaml });
    expect(screenPreview(project, { ...settingsScreen, projectId: "other" })).toEqual({
      lines: [],
    });
    expect(screenPreview(project, { ...settingsScreen, table: "data/missing" })).toEqual({
      lines: [],
    });
  });
});
