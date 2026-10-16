import { describe, expect, it } from "vitest";
import pay from "../../../docs/schema/command/v1/examples/pay-player.json";
import profile from "../../../docs/schema/command/v1/examples/profile-with-target.json";
import heal from "../../../docs/schema/command/v1/examples/simple-heal.json";
import schema from "../../../docs/schema/command/v1/schema.json";

describe("command/v1 schema shape", () => {
  it("uses `actions` (ClickHandler) as the canonical body, `steps` as legacy", () => {
    const props = (schema as any).properties;
    expect(props.actions.$ref).toContain("ClickHandler");
    expect(props.steps.$ref).toContain("ClickHandler");
    expect((schema as any).required).toEqual(["schema"]);
    expect((schema as any).anyOf).toEqual([{ required: ["actions"] }, { required: ["steps"] }]);
  });

  it("name is optional (defaults to id at load)", () => {
    expect((schema as any).required).not.toContain("name");
  });

  it("keeps requirements as Condition arrays, fallback as Step arrays", () => {
    const props = (schema as any).properties;
    expect(props.requirements.items.$ref).toContain("#/$defs/Condition");
    expect(props.fallback.items.$ref).toContain("#/$defs/Step");
  });

  it("all examples use the canonical `actions` DSL string, not legacy `steps`", () => {
    for (const ex of [pay, profile, heal] as any[]) {
      expect(typeof ex.actions).toBe("string");
      expect(ex.actions.length).toBeGreaterThan(0);
      expect(ex.steps).toBeUndefined();
    }
  });
});
