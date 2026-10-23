import type { ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

const base = "plugins/Artisan/projects/p";

describe("command/v1 round trip", () => {
  it("writes back what the editor does not edit, so a deploy never drops it", () => {
    const files = {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\ndefault_lang: fr\nlanguages: [fr]\n",
      [`${base}/commands/heal.yaml`]: [
        "schema: command/v1",
        "name: soin",
        "arguments:",
        "  - { name: monde, type: world, required: false }",
        "  - { name: rang, type: enum, values: [a, b] }",
        "requirements:",
        "  - { type: has_permission, permission: a.b }",
        "fallback:",
        "  - close_menu",
        "cooldown: { id: heal, duration_seconds: 30, scope: player }",
        "actions:",
        "  - close_menu",
        "",
      ].join("\n"),
    };
    const out = projectToFiles(projectFromFiles("p" as ProjectId, files));
    const heal = parse(out[`${base}/commands/heal.yaml`] as string);
    expect(heal).toMatchObject({
      schema: "command/v1",
      name: "soin",
      cooldown: { id: "heal", duration_seconds: 30, scope: "player" },
      requirements: [{ type: "has_permission", permission: "a.b" }],
      fallback: ["close_menu"],
      arguments: [
        { name: "monde", type: "world", required: false },
        { name: "rang", type: "enum", values: ["a", "b"], required: true },
      ],
    });
    expect(Object.keys(heal)[0]).toBe("schema");
  });
});
