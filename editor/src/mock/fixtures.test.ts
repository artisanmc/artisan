import { describe, expect, it } from "vitest";
import { mockOpenProjects } from "./fixtures";

describe("mockOpenProjects fixture", () => {
  it("contains three projects in order", () => {
    const openProjects = mockOpenProjects();
    expect(openProjects.projects).toHaveLength(3);
    expect(openProjects.projects.map((p) => p.name)).toEqual([
      "Personal",
      "Shop System",
      "Daily Quests",
    ]);
  });
});
