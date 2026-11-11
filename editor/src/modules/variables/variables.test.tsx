import "@/i18n";
import type { Project, ProjectId } from "@/domain/types";
import { ExpressionConditionField } from "@/features/inspector/properties/ExpressionConditionField";
import { variableEntries } from "@/lib/placeholderCatalog/compute";
import { render, screen } from "@testing-library/react";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import menuSchema from "../../../../docs/schema/menu/v1/schema.json";
import triggerSchema from "../../../../docs/schema/trigger/v1/schema.json";
import lastDeath from "../../../../docs/schema/variable/v1/examples/last-death.json";
import season from "../../../../docs/schema/variable/v1/examples/season.json";
import variableSchema from "../../../../docs/schema/variable/v1/schema.json";
import { acceptsValue, variableFromFile, variableToFile } from "./variable";

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(menuSchema);
const validateVariable = ajv.compile(variableSchema);
const validateTrigger = ajv.compile(triggerSchema);

describe("the variable/v1 format", () => {
  it.each([
    ["last-death", lastDeath],
    ["season", season],
  ])("reads example %s back and rewrites it identically, valid", (_, example) => {
    const v = variableFromFile({ id: "x", ...example }, "p");
    const { id, ...written } = variableToFile(v);
    expect(id).toBe("x");
    expect(written).toEqual(example);
    expect(validateVariable(written), JSON.stringify(validateVariable.errors)).toBe(true);
  });

  it("reads an unknown type as a string and drops a zero lifetime", () => {
    const v = variableFromFile(
      { schema: "variable/v1", id: "a", type: "color", expires_seconds: 0 },
      "p",
    );
    expect(v.type).toBe("string");
    expect(v.expiresSeconds).toBeUndefined();
  });

  it.each([
    ["number", 3, true],
    ["number", "3", false],
    ["boolean", false, true],
    ["location", "world 1 64 -2", true],
    ["location", "world 1 64 -2 90 0", true],
    ["location", { world: "world", x: 1, y: 2, z: 3 }, true],
    ["location", "world 1 64", false],
  ] as const)("a %s accepts %j: %s", (type, value, ok) => {
    expect(acceptsValue(type, value)).toBe(ok);
  });
});

describe("the actions and conditions on Variables in a chain", () => {
  it("validates set_var, add_var, clear_var, chat_button, teleport to a location and has_var", () => {
    const trigger = {
      schema: "trigger/v1",
      on: "player_death",
      if: [{ has_var: "season" }, { expression: "var.vip" }],
      do: [
        { set_var: { var: "last_death", value: "{event.location}" } },
        { add_var: "deaths" },
        { add_var: { var: "coins", amount: "{0 - var.coins}" } },
        { clear_var: "streak" },
        {
          chat_button: {
            text: "<gray>You died.",
            label: "<gold>[Back]",
            expires_seconds: 600,
            do: [{ teleport: "{var.last_death}" }],
          },
        },
        { teleport: { location: { world: "world", x: 0, y: "{var.height}", z: 0 } } },
        { give_money: "{var.coins}" },
        { play_sound: { sound: "ENTITY_PLAYER_LEVELUP", volume: "{var.volume}" } },
      ],
    };
    expect(validateTrigger(trigger), JSON.stringify(validateTrigger.errors)).toBe(true);
  });

  it("refuses a chat_button without its click actions", () => {
    const trigger = {
      schema: "trigger/v1",
      on: "player_join",
      do: [{ chat_button: { label: "[x]" } }],
    };
    expect(validateTrigger(trigger)).toBe(false);
  });
});

describe("the placeholder catalog", () => {
  it("lists the project's Variables, then the server's unkeyed module Variables", () => {
    const project = {
      id: "p" as ProjectId,
      documents: {
        variable: [
          { id: "coins", type: "number" },
          { id: "guilds", type: "string" },
        ],
      },
    } as unknown as Project;
    const entries = variableEntries(project, [
      { name: "guilds.rank", type: "string", key: null },
      { name: "quests.status", type: "string", key: { name: "quest" } },
      { name: "lands.claims", type: "number", key: null },
    ]);
    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ["var.coins", "number"],
      ["var.guilds", "string"],
      ["var.lands.claims", "number"],
    ]);
  });
});

describe("an expression condition", () => {
  it("warns that a placeholder alone is always true", () => {
    render(<ExpressionConditionField expr="%essentials_vanished%" onChange={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/placeholder/i);
  });

  it("says nothing about a comparison", () => {
    render(<ExpressionConditionField expr='%essentials_vanished% == "yes"' onChange={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
