import { type EditorHost, installEditorHost } from "@artisan/editor-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type QuestGroup,
  freeKey,
  newUid,
  parseQuestGroup,
  questGroupTextSites,
  serializeQuestGroup,
  slugKey,
  typedKey,
} from "./model";

/** The host's text store, reduced to what the codec reads. */
let n = 0;
let texts: Record<string, Record<string, string>> = {};
const project = { defaultLang: "fr" };

beforeEach(() => {
  n = 0;
  texts = {};
  installEditorHost({
    newTextKey: () => `k${++n}`,
    fieldText: (_p: unknown, key: string) => {
      const entry = texts[key] ?? {};
      const langs = Object.keys(entry);
      if (langs.length === 0 || (langs.length === 1 && langs[0] === "fr")) return entry.fr ?? "";
      return { ...entry };
    },
  } as unknown as EditorHost);
});

const daily = {
  id: "daily",
  schema: "quest_group/v1",
  uid: "01JQ8AAAAAAAAAAAAAAAAAAAAA",
  title: { fr: "Quêtes journalières", en: "Daily quests" },
  actor_type: "player",
  window: { start: "2024-01-01T00:00:00Z" },
  reset: { cron: "0 4 * * *", timezone: "Europe/Paris" },
  limits: { max_active: 6, max_per_period: 6 },
  rotation: { enabled: true, max_per_period: 2 },
  distribution: {
    strategy: "random",
    amount: 6,
    triggers: ["actor_load", "period_reset"],
    tiers: { easy: 3 },
  },
  tiers: { easy: { title: { fr: "<green>Facile" } } },
  on: { quest_complete: [{ type: "command", command: "say done" }] },
  quests: [
    {
      key: "mine_stone_64",
      uid: "01JQ9AAAAAAAAAAAAAAAAAAAAA",
      tier: "easy",
      title: { fr: "Apprenti carrier", en: "Apprentice quarrier" },
      description: "Mine 64 blocs de pierre",
      duration: "24h",
      stages: [
        {
          key: "mining",
          title: { fr: "Minage" },
          flow: "parallel",
          objectives: [{ key: "stone", type: "block_break", material: "STONE", amount: 64 }],
        },
      ],
      rewards: [{ type: "command", command: "levels addxp {player} 150", name: "+150 XP" }],
      requirements: [{ type: "permission", permission: "quests.vip" }],
    },
  ],
};

function roundTrip(src: Record<string, unknown>) {
  const r = parseQuestGroup(src, { projectId: "p", lang: "fr" });
  Object.assign(texts, r.i18nKeys);
  return { r, out: serializeQuestGroup(r.doc as QuestGroup, project) };
}

describe("quest_group codec", () => {
  it("round-trips a production group without losing a field", () => {
    const { r, out } = roundTrip(daily);
    expect(r.unsupported).toEqual([]);
    // A text in the default language alone is written as a bare string (ADR `field-local-translations`).
    const quest = daily.quests[0]!;
    expect(out).toEqual({
      ...daily,
      tiers: { easy: { title: "<green>Facile" } },
      quests: [{ ...quest, stages: [{ ...quest.stages[0], title: "Minage" }] }],
    });
  });

  it("writes the canonical key order the server's files use", () => {
    const { out } = roundTrip(daily);
    expect(Object.keys(out)).toEqual([
      "id",
      "schema",
      "uid",
      "title",
      "actor_type",
      "window",
      "reset",
      "limits",
      "rotation",
      "distribution",
      "tiers",
      "on",
      "quests",
    ]);
  });

  it("turns each text into a node and keeps its languages", () => {
    const { r } = roundTrip(daily);
    const group = r.doc as QuestGroup;
    expect(texts[group.title.key]).toEqual({ fr: "Quêtes journalières", en: "Daily quests" });
    expect(texts[group.quests[0]!.description.key]).toEqual({ fr: "Mine 64 blocs de pierre" });
  });

  it("resolves an `{i18n:key}` ref against the project's translations", () => {
    const r = parseQuestGroup(
      { ...daily, title: "{i18n:common.daily}" },
      { projectId: "p", lang: "fr", translations: { "common.daily": { fr: "Jour" } } },
    );
    expect((r.doc as QuestGroup).title.key).toBe("common.daily");
    expect(r.i18nKeys["common.daily"]).toEqual({ fr: "Jour" });
  });

  it("drops what was cleared and keeps an empty group's quest list", () => {
    const { r } = roundTrip({
      id: "empty",
      schema: "quest_group/v1",
      uid: "U",
      title: "Vide",
      actor_type: "player",
    });
    const group = r.doc as QuestGroup;
    group.limits.max_active = undefined;
    expect(serializeQuestGroup(group, project)).toEqual({
      id: "empty",
      schema: "quest_group/v1",
      uid: "U",
      title: "Vide",
      actor_type: "player",
      quests: [],
    });
  });

  it("gives a uid to what has none and reports a foreign schema", () => {
    const r = parseQuestGroup(
      { id: "x", schema: "quest_group/v9", quests: [{ key: "a" }] },
      { projectId: "p", lang: "fr" },
    );
    const group = r.doc as QuestGroup;
    expect(group.uid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(group.quests[0]!.uid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.unsupported).toEqual(["schema: quest_group/v9"]);
  });
});

describe("text sites", () => {
  it("addresses quests by uid and stages by key, so a reorder moves no text", () => {
    const { r } = roundTrip(daily);
    const keys = [...questGroupTextSites(r.doc as QuestGroup)].map((s) => s.key);
    expect(keys).toEqual([
      "quest_groups.daily.title",
      "quest_groups.daily.description",
      "quest_groups.daily.tiers.easy.title",
      "quest_groups.daily.quests.01JQ9AAAAAAAAAAAAAAAAAAAAA.title",
      "quest_groups.daily.quests.01JQ9AAAAAAAAAAAAAAAAAAAAA.description",
      "quest_groups.daily.quests.01JQ9AAAAAAAAAAAAAAAAAAAAA.stages.mining.title",
    ]);
  });

  it("never gives two sites the same key, even from a hand-edited file", () => {
    const quest = daily.quests[0]!;
    const { r } = roundTrip({ ...daily, quests: [quest, quest] });
    const keys = [...questGroupTextSites(r.doc as QuestGroup)].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("keys and ids", () => {
  it("mints time-ordered ULIDs", () => {
    expect(newUid(0) < newUid(1_000_000)).toBe(true);
    expect(newUid()).toHaveLength(26);
  });

  it("makes typed keys safe and unique", () => {
    expect(slugKey("Mine la Pierre ! ")).toBe("mine_la_pierre");
    expect(slugKey("éé")).toBe("ee");
    expect(slugKey("!!")).toBe("quest");
    expect(typedKey("Mine ")).toBe("mine_");
    expect(freeKey("quest", ["quest", "quest_2"])).toBe("quest_3");
  });
});
