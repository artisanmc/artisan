import { describe, expect, it } from "vitest";
import { mockAccount } from "./fixtures";

describe("mockAccount fixture", () => {
  it("contains three projects in order", () => {
    const account = mockAccount();
    expect(account.projects).toHaveLength(3);
    expect(account.projects.map((p) => p.name)).toEqual(["Personal", "Shop System", "Daily Quests"]);
  });
});
