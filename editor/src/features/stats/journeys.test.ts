import { describe, expect, it } from "vitest";
import {
  actionLabel,
  formatFilter,
  journeyId,
  journeyPeriod,
  journeyProblems,
  parseFilter,
  retentionCurve,
  retentionShare,
} from "./journeys";

describe("journeys", () => {
  it("reads a filter written name=value, and writes it back", () => {
    expect(parseFilter("quest=intro, group = story")).toEqual({ quest: "intro", group: "story" });
    expect(parseFilter("")).toEqual({});
    expect(parseFilter("menu=shop:main")).toEqual({ menu: "shop:main" });
    expect(parseFilter("intro")).toBeNull();
    expect(parseFilter("Bad Key=x")).toBeNull();
    expect(formatFilter({ quest: "intro", group: "story" })).toBe("quest=intro, group=story");
  });

  it("names a new journey after its name, without taking a used id", () => {
    expect(journeyId("Découverte du serveur", [])).toBe("decouverte-du-serveur");
    expect(journeyId("Onboarding", ["onboarding", "onboarding-2"])).toBe("onboarding-3");
    expect(journeyId("???", [])).toBe("journey");
  });

  it("says what the hub would refuse", () => {
    const goal = { name: "First quest", event: "quests:completed", dims: {} };
    expect(journeyProblems({ id: "a", name: "A", windowDays: 7, goals: [goal] })).toEqual([]);
    expect(
      journeyProblems({
        id: "a",
        name: " ",
        windowDays: 0,
        goals: [{ name: "", event: "Not an event", dims: {} }],
      }).sort(),
    ).toEqual(["goalEvent", "goalName", "name", "window"]);
    expect(
      journeyProblems({ id: "a", name: "A", windowDays: 7, goals: Array(9).fill(goal) }),
    ).toEqual(["tooManyGoals"]);
  });

  it("draws the retention curve from day 0 over the days that can be told", () => {
    expect(
      retentionCurve([
        { day: 1, eligible: 40, returned: 10 },
        { day: 2, eligible: 20, returned: 2 },
        { day: 3, eligible: 0, returned: 0 },
      ]),
    ).toEqual([
      { day: 0, share: 1 },
      { day: 1, share: 0.25 },
      { day: 2, share: 0.1 },
    ]);
    expect(retentionCurve([{ day: 1, eligible: 0, returned: 0 }])).toEqual([]);
  });

  it("gives a retention share only when someone is old enough to tell", () => {
    expect(retentionShare({ day: 1, eligible: 40, returned: 10 })).toBe(0.25);
    expect(retentionShare({ day: 30, eligible: 0, returned: 0 })).toBeNull();
    expect(retentionShare(undefined)).toBeNull();
  });

  it("labels an action and keeps the period within what raw rows cover", () => {
    expect(actionLabel("core:menu_open", { menu: "jobs:main" })).toBe("core:menu_open · jobs:main");
    expect(actionLabel("core:first_join", {})).toBe("core:first_join");
    expect(journeyPeriod({ from: 0, to: 10 * 86400 })).toEqual({ from: 0, to: 10 * 86400 });
    expect(journeyPeriod({ from: 0, to: 365 * 86400 })).toEqual({
      from: 273 * 86400,
      to: 365 * 86400,
    });
  });
});
