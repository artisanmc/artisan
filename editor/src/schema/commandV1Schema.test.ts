import { describe, expect, it } from "vitest";
import schema from "../../../docs/schema/command/v1/schema.json";
import pay from "../../../docs/schema/command/v1/examples/pay-player.json";
import profile from "../../../docs/schema/command/v1/examples/profile-with-target.json";
import heal from "../../../docs/schema/command/v1/examples/simple-heal.json";

describe("command/v1 schema shape", () => {
  it("uses `actions` (DSL string) as the canonical body, `steps` as legacy", () => {
    const props = (schema as any).properties;
    expect(props.actions.type).toBe("string");
    expect(props.steps.type).toBe("string");
    expect((schema as any).required).toEqual(["schema", "id"]);
    expect((schema as any).anyOf).toEqual([{ required: ["actions"] }, { required: ["steps"] }]);
  });

  it("name is optional (defaults to id at load)", () => {
    expect((schema as any).required).not.toContain("name");
  });

  it("keeps requirements/fallback as flat Action arrays", () => {
    const props = (schema as any).properties;
    expect(props.requirements.items.$ref).toContain("#/$defs/Condition");
    expect(props.fallback.items.$ref).toContain("#/$defs/Action");
  });

  it("all examples use the canonical `actions` DSL string, not legacy `steps`", () => {
    for (const ex of [pay, profile, heal] as any[]) {
      expect(typeof ex.actions).toBe("string");
      expect(ex.actions.length).toBeGreaterThan(0);
      expect(ex.steps).toBeUndefined();
    }
  });
});
