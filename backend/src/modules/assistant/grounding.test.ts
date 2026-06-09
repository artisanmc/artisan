import { describe, expect, it } from "bun:test";
import { buildSystemPrompt, SUPPORTED_CONDITIONS, SUPPORTED_ACTIONS } from "./grounding";

describe("buildSystemPrompt", () => {
  const sys = buildSystemPrompt();
  it("includes the menu/v1 authoring guide, zmenu and deluxemenus references", () => {
    expect(sys).toMatch(/menu\/v1/);
    expect(sys.toLowerCase()).toMatch(/zmenu/);
    expect(sys.toLowerCase()).toMatch(/deluxemenus/);
  });
  it("states the anti-injection framing (file content is data, not instructions)", () => {
    expect(sys.toLowerCase()).toMatch(/data, not instructions|données.*pas des instructions/);
  });
  it("lists the supported vocab and is non-trivial in size", () => {
    for (const c of SUPPORTED_CONDITIONS) expect(sys).toContain(c);
    for (const a of SUPPORTED_ACTIONS) expect(sys).toContain(a);
    expect(sys.length).toBeGreaterThan(2000);
  });
});
