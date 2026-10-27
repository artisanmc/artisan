import type { DeclaredCommand } from "@/lib/api/playerCommands";
import { describe, expect, it } from "vitest";
import {
  argDrift,
  fileArgType,
  findDeclaredCommand,
  moduleCommandIdOf,
  moduleCommandSteps,
} from "./moduleCommands";
import type { CommandArg, Step } from "./types";

const ah: DeclaredCommand = {
  id: "auctions:ah",
  moduleId: "auctions",
  name: "ah",
  arguments: [],
  children: [
    {
      id: "auctions:ah.auction",
      moduleId: "auctions",
      name: "auction",
      arguments: [
        { name: "price", type: "int", required: true, values: [] },
        { name: "duration", type: "text", required: false, values: [] },
      ],
      children: [],
    },
  ],
};

const arg = (name: string, type: CommandArg["type"], required = true): CommandArg => ({
  name,
  type,
  required,
});

describe("moduleCommands", () => {
  it("finds a sub-command by id", () => {
    expect(findDeclaredCommand([ah], "auctions:ah.auction")?.name).toBe("auction");
    expect(findDeclaredCommand([ah], "auctions:nope")).toBeUndefined();
  });

  it("reads the command of both wire forms", () => {
    expect(moduleCommandIdOf("auctions:ah")).toBe("auctions:ah");
    expect(moduleCommandIdOf({ command: "auctions:ah.auction", args: {} })).toBe(
      "auctions:ah.auction",
    );
    expect(moduleCommandIdOf({ args: {} })).toBeNull();
  });

  it("finds module_command steps inside conditions", () => {
    const steps: Step[] = [
      { kind: "action", action: { name: "send_message", value: "hi" } },
      {
        kind: "if",
        cases: [{ conditions: [], steps: [] }],
        else: [
          {
            kind: "action",
            action: { name: "module_command", value: { command: "auctions:ah", args: { a: "1" } } },
          },
        ],
      },
    ];
    expect(moduleCommandSteps(steps)).toEqual([{ id: "auctions:ah", args: { a: "1" } }]);
  });

  it("types a declared argument as the file writes it", () => {
    expect(fileArgType("int")).toBe("integer");
    expect(fileArgType("text")).toBe("string");
    expect(fileArgType("player")).toBe("player");
  });

  it("reports nothing while the file matches the module", () => {
    const declared = findDeclaredCommand([ah], "auctions:ah.auction")?.arguments ?? [];
    expect(argDrift([arg("price", "integer"), arg("duration", "string", false)], declared)).toEqual(
      [],
    );
  });

  it("reports a renamed, retyped or removed argument", () => {
    const declared = findDeclaredCommand([ah], "auctions:ah.auction")?.arguments ?? [];
    expect(argDrift([arg("cost", "integer"), arg("duration", "integer", false)], declared)).toEqual(
      [
        { kind: "missing", name: "price", type: "integer", required: true },
        { kind: "type", name: "duration", type: "integer", expected: "string" },
        { kind: "extra", name: "cost" },
      ],
    );
  });

  it("keeps quiet about an argument the step maps, and an extra one alone", () => {
    const declared = findDeclaredCommand([ah], "auctions:ah.auction")?.arguments ?? [];
    expect(
      argDrift([arg("cost", "integer"), arg("duration", "string", false)], declared, {
        price: "{cost}",
      }),
    ).toEqual([]);
  });
});
