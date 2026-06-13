import { describe, expect, it } from "vitest";
import schema from "../../../docs/schema/command/v1/schema.json";
import pay from "../../../docs/schema/command/v1/examples/pay-player.json";
import profile from "../../../docs/schema/command/v1/examples/profile-with-target.json";
import heal from "../../../docs/schema/command/v1/examples/simple-heal.json";

describe("command/v1 schema shape", () => {
  it("uses `steps` (not flat `actions`) as the executable body", () => {
    const props = (schema as any).properties;
    expect(props.steps).toBeDefined();
    expect(props.actions).toBeUndefined();
    expect((schema as any).required).toContain("steps");
    expect((schema as any).required).not.toContain("actions");
  });

  it("steps items reference menu/v1 Step (if-support)", () => {
    const ref = (schema as any).properties.steps.items.$ref as string;
    expect(ref).toBe("https://docs.artisanmc.net/schema/menu/v1.json#/$defs/Step");
  });

  it("keeps requirements/fallback as flat Action arrays", () => {
    const props = (schema as any).properties;
    expect(props.requirements.items.$ref).toContain("#/$defs/Condition");
    expect(props.fallback.items.$ref).toContain("#/$defs/Action");
  });

  it("all examples use steps, not actions", () => {
    for (const ex of [pay, profile, heal] as any[]) {
      expect(Array.isArray(ex.steps)).toBe(true);
      expect(ex.actions).toBeUndefined();
      expect(ex.steps[0].kind).toBe("action");
    }
  });
});
