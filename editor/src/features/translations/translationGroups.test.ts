import type { I18nKey } from "@/domain/types";
import type { TranslationRow } from "@/lib/i18nUsages";
import { describe, expect, it } from "vitest";
import { categoryOf, groupRows, rowMatches } from "./translationGroups";

const row = (key: string, context = key, source = "", target = ""): TranslationRow => ({
  key: key as I18nKey,
  context,
  source,
  target,
});

describe("groupRows", () => {
  it("groups by Document, variant, data source, lang/ segment, then the leftovers", () => {
    const groups = groupRows([
      row("menus.calendar.title"),
      row("menus.calendar.elements.milestones.default.lore"),
      row("lt_x", "commands.daily claim.description"),
      row("lt_y", "variants.bedrock.menus.calendar.title"),
      row("sources.rewards.default_day.title"),
      row("reminder", "(lang/ only)"),
      row("claim.success", "(lang/ only)"),
      row("claim.broken", "(lang/ only)"),
      row("lt_z", "(unused)"),
    ]);
    expect(groups.map((g) => [g.kind, g.id, g.rows.length])).toEqual([
      ["document", "menus.calendar", 2],
      ["document", "commands.daily", 1],
      ["document", "variants.bedrock.menus.calendar", 1],
      ["document", "sources.rewards", 1],
      ["langRoot", "", 1],
      ["lang", "claim", 2],
      ["unused", "(unused)", 1],
    ]);
  });
});

describe("categoryOf", () => {
  it("files each group under menus, commands, dialogs, data, module, lang or unused", () => {
    const groups = groupRows([
      row("menus.calendar.title"),
      row("lt_y", "variants.bedrock.menus.calendar.title"),
      row("lt_x", "commands.daily claim.description"),
      row("dialogs.welcome.title"),
      row("sources.rewards.default_day.title"),
      row("quest_groups.main.title"),
      row("claim.success", "(module)"),
      row("reminder", "(module)"),
      row("artisan.duration.days", "(lang/ only)"),
      row("lt_z", "(unused)"),
    ]);
    expect(groups.map((g) => [g.kind, g.id, categoryOf(g)])).toEqual([
      ["document", "menus.calendar", "menus"],
      ["document", "variants.bedrock.menus.calendar", "menus"],
      ["document", "commands.daily", "commands"],
      ["document", "dialogs.welcome", "dialogs"],
      ["document", "sources.rewards", "data"],
      ["document", "quest_groups.main", "documents"],
      ["module", "claim", "module"],
      ["module", "", "module"],
      ["lang", "artisan", "lang"],
      ["unused", "(unused)", "unused"],
    ]);
  });
});

describe("rowMatches", () => {
  it("matches every word, in the key, the place or either text, any case", () => {
    const r = row("menus.calendar.title", "menus.calendar.title", "<gold>Daily", "Quotidien");
    expect(rowMatches(r, "")).toBe(true);
    expect(rowMatches(r, "calendar quotidien")).toBe(true);
    expect(rowMatches(r, "DAILY")).toBe(true);
    expect(rowMatches(r, "calendar shop")).toBe(false);
  });
});
