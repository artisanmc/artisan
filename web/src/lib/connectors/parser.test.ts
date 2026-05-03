import { describe, expect, it } from "vitest";
import { parseConnectorYaml } from "./parser";

describe("parseConnectorYaml", () => {
  it("parses a simple list-of-string connector", () => {
    const yaml = `
ref: example:tags
schema:
  kind: list
  of:
    kind: string
sample:
  - foo
  - bar
`;
    const result = parseConnectorYaml(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.ref).toBe("example:tags");
      expect(result.spec.type).toEqual({ kind: "list", of: { kind: "string" } });
      expect(result.spec.sample).toEqual(["foo", "bar"]);
    }
  });

  it("parses a list-of-object connector with all field types", () => {
    const yaml = `
ref: chestshop:items
schema:
  kind: list
  of:
    kind: object
    fields:
      - { name: id, type: { kind: string } }
      - { name: price, type: { kind: number } }
      - { name: stock, type: { kind: integer } }
      - { name: enabled, type: { kind: boolean } }
sample:
  - { id: diamond, price: 100, stock: 5, enabled: true }
`;
    const result = parseConnectorYaml(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.ref).toBe("chestshop:items");
      expect((result.spec.type as { kind: "list" }).kind).toBe("list");
    }
  });

  it("parses a recursively nested schema", () => {
    const yaml = `
ref: deep:thing
schema:
  kind: list
  of:
    kind: object
    fields:
      - { name: tags, type: { kind: list, of: { kind: string } } }
sample:
  - { tags: [a, b] }
`;
    const result = parseConnectorYaml(yaml);
    expect(result.ok).toBe(true);
  });

  it("rejects empty input", () => {
    const result = parseConnectorYaml("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty");
  });

  it("rejects malformed YAML", () => {
    const result = parseConnectorYaml("ref: chestshop:items\nschema: [unclosed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects when ref is missing", () => {
    const result = parseConnectorYaml("schema: { kind: string }\nsample: x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ref");
  });

  it("rejects when ref is not a string", () => {
    const result = parseConnectorYaml("ref: 42\nschema: { kind: string }\nsample: x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ref");
  });

  it("rejects when schema is missing", () => {
    const result = parseConnectorYaml("ref: x:y\nsample: hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("schema");
  });

  it("rejects when schema kind is unknown", () => {
    const result = parseConnectorYaml("ref: x:y\nschema: { kind: foo }\nsample: hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("kind");
  });

  it("rejects when sample doesn't match schema", () => {
    const result = parseConnectorYaml(`
ref: x:y
schema: { kind: list, of: { kind: string } }
sample: not-an-array
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("sample");
  });

  it("rejects when object schema field name is missing", () => {
    const result = parseConnectorYaml(`
ref: x:y
schema: { kind: object, fields: [{ type: { kind: string } }] }
sample: {}
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
