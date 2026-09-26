import { describe, expect, test } from "bun:test";
import { collaboratorCount, planLimits, withinPlanLimit } from "./planLimits";

describe("editor plan limits", () => {
  test("publishes Free and Pro caps", () => {
    expect(planLimits.free).toEqual({ resourcesPerServer: 10, servers: 2, collaborators: 2 });
    expect(planLimits.pro).toEqual({ resourcesPerServer: 250, servers: 10, collaborators: null });
  });

  test("accepts the final allowed slot and rejects the next", () => {
    expect(withinPlanLimit(1, 2)).toBe(true);
    expect(withinPlanLimit(2, 2)).toBe(false);
    expect(withinPlanLimit(250, null)).toBe(true);
  });

  test("counts additional owners as collaborators", () => {
    expect(collaboratorCount(["owner", "owner", "member"])).toBe(2);
  });
});
