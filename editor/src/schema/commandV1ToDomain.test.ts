import { projectId } from "@/domain/ids";
import { describe, expect, it } from "vitest";
import { commandV1ToDomain } from "./commandV1ToDomain";

const opts = { projectId: projectId("p1"), lang: "en" };

describe("commandV1ToDomain", () => {
  it("maps id/name/aliases/permission/description and steps", () => {
    const { command, i18nKeys } = commandV1ToDomain(
      {
        schema: "command/v1",
        id: "heal",
        name: "heal",
        aliases: ["h"],
        permission: "a.heal",
        description: "Heal",
        steps: "close_menu",
      },
      opts,
    );
    expect(command.id).toBe("heal");
    expect(command.name).toBe("heal");
    expect(command.aliases).toEqual(["h"]);
    expect(command.permission).toBe("a.heal");
    // The description is a text slot: a bare string is the default language's.
    expect(i18nKeys[command.description!.key]).toEqual({ [opts.lang]: "Heal" });
    expect(command.projectId).toBe("p1");
    expect(command.steps).toEqual([
      { kind: "action", action: { name: "close_menu", value: null } },
    ]);
  });

  it("maps arguments, online_player→player, and extracts send_message i18n", () => {
    const { command, i18nKeys } = commandV1ToDomain(
      {
        schema: "command/v1",
        id: "pay",
        name: "pay",
        arguments: [
          { name: "target", type: "online_player", required: true },
          { name: "amount", type: "integer", required: true },
        ],
        steps: 'send_message "ok"',
      },
      opts,
    );
    expect(command.arguments).toEqual([
      { name: "target", type: "player", required: true },
      { name: "amount", type: "integer", required: true },
    ]);
    const a = command.steps[0] as any;
    expect(i18nKeys[a.action.value.key]).toEqual({ en: "ok" });
  });

  it("reads the canonical `actions` field and defaults name to id", () => {
    const { command } = commandV1ToDomain(
      { schema: "command/v1", id: "boutique", actions: "close_menu" },
      opts,
    );
    expect(command.name).toBe("boutique");
    expect(command.steps).toEqual([
      { kind: "action", action: { name: "close_menu", value: null } },
    ]);
  });

  it("prefers `actions` over legacy `steps` when both are present", () => {
    const { command } = commandV1ToDomain(
      { schema: "command/v1", id: "c", actions: "close_menu", steps: 'send_message "old"' },
      opts,
    );
    expect(command.steps).toEqual([
      { kind: "action", action: { name: "close_menu", value: null } },
    ]);
  });

  it("keeps requirements, fallback, cooldown and unknown argument types for the way back", () => {
    const { command, unsupported } = commandV1ToDomain(
      {
        schema: "command/v1",
        id: "c",
        name: "c",
        arguments: [{ name: "w", type: "world", required: false, description: "the world" }],
        requirements: [{ type: "has_money", amount: 1 }],
        fallback: [{ name: "close_menu", value: null }],
        cooldown: { id: "x", duration_seconds: 5 },
        notes: "kept",
        steps: "close_menu",
      },
      opts,
    );
    expect(command.arguments[0]).toEqual({
      name: "w",
      type: "string",
      wireType: "world",
      required: false,
      wire: { description: "the world" },
    });
    expect(command.wire).toEqual({
      requirements: [{ type: "has_money", amount: 1 }],
      fallback: [{ name: "close_menu", value: null }],
      cooldown: { id: "x", duration_seconds: 5 },
      notes: "kept",
    });
    expect(unsupported).toEqual([]);
  });
});
