import { describe, expect, it } from "vitest";
import pay from "../../../docs/schema/command/v1/examples/pay-player.json";
import auctionHouse from "../../../docs/schema/command/v1/examples/auction-house-subcommands.json";
import profile from "../../../docs/schema/command/v1/examples/profile-with-target.json";
import heal from "../../../docs/schema/command/v1/examples/simple-heal.json";
import schema from "../../../docs/schema/command/v1/schema.json";

describe("command/v1 schema shape", () => {
  it("uses `actions` (ClickHandler) as the canonical body, `steps` as legacy", () => {
    const props = (schema as any).properties;
    expect(props.actions.$ref).toContain("ClickHandler");
    expect(props.steps.$ref).toContain("ClickHandler");
    expect((schema as any).required).toEqual(["schema"]);
    expect((schema as any).anyOf).toEqual([{ required: ["actions"] }, { required: ["steps"] }, { required: ["subcommands"] }]);
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
    for (const ex of [pay, profile, heal, auctionHouse] as any[]) {
      expect(typeof ex.actions).toBe("string");
      expect(ex.actions.length).toBeGreaterThan(0);
      expect(ex.steps).toBeUndefined();
    }
  });

  it("nests sub-commands with the same node fields, at any depth", () => {
    const sub = (schema as any).$defs.Subcommand;
    expect(sub.required).toEqual(["name"]);
    expect(sub.properties.subcommands.items.$ref).toBe("#/$defs/Subcommand");
    for (const key of ["aliases", "permission", "description", "enabled", "arguments", "requirements", "actions", "fallback", "cooldown"]) {
      expect(sub.properties[key], key).toBeDefined();
    }
    expect((schema as any).properties.description.$ref).toBe("#/$defs/LocalizedText");
    expect((auctionHouse as any).subcommands[1].subcommands).toHaveLength(2);
  });
});
