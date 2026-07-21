import { describe, expect, it } from "vitest";
import { makeStepConverter, type ConverterCtx } from "./actionV1ToDomain";
import type { I18nKey, LText } from "@/domain/types";

function ctx(): ConverterCtx & { unsupported: string[]; keys: Record<string, Record<string, string>> } {
  const unsupported: string[] = [];
  const keys: Record<string, Record<string, string>> = {};
  let n = 0;
  return {
    unsupported,
    keys,
    pushUnsupported: (s: string) => unsupported.push(s),
    text: (raw?: string): LText => {
      const key = `k_${n++}`;
      keys[key] = { en: raw ?? "" };
      return { key: key as I18nKey };
    },
    ref: (key: string): LText => ({ key: key as I18nKey }),
  };
}

describe("makeStepConverter — DSL steps (Phase 2)", () => {
  it("parses a flat open_menu action from a DSL string", () => {
    const c = ctx();
    const { steps } = makeStepConverter(c);
    expect(steps("open_menu shop")).toEqual([
      { kind: "action", action: { type: "open_menu", menuId: "shop" } },
    ]);
  });

  it("parses an if-step with a typed condition and nested action", () => {
    const c = ctx();
    const { steps } = makeStepConverter(c);
    expect(steps("if has_permission(a.b):\n  close_menu")).toEqual([
      {
        kind: "if",
        cases: [
          {
            conditions: [{ type: "has_permission", perm: "a.b" }],
            steps: [{ kind: "action", action: { type: "close_menu" } }],
          },
        ],
      },
    ]);
  });

  it("mints an i18n key for a literal send_message, resolves @key via ref", () => {
    const c = ctx();
    const { steps } = makeStepConverter(c);
    const litStep = steps('send_message "hi"')[0] as unknown as { action: { text: LText } };
    expect(c.keys[litStep.action.text.key]).toEqual({ en: "hi" });

    const refStep = steps("send_message @greeting")[0] as unknown as { action: { text: LText } };
    expect(refStep.action.text.key).toBe("greeting");
  });

  it("blank / non-string input yields no steps", () => {
    const c = ctx();
    const { steps } = makeStepConverter(c);
    expect(steps("")).toEqual([]);
    expect(steps(undefined)).toEqual([]);
  });

  it("records an unsupported entry on an unparseable DSL string", () => {
    const c = ctx();
    const { steps } = makeStepConverter(c);
    expect(steps("this is !!! not valid dsl @@")).toEqual([]);
    expect(c.unsupported.some((u) => u.startsWith("steps:"))).toBe(true);
  });

  it("still maps appearance-level conditions and if-arrays (unchanged)", () => {
    const c = ctx();
    const { condition, ifArray } = makeStepConverter(c);
    expect(condition({ type: "has_money", amount: 100 })).toEqual({ type: "has_money", amount: 100 });
    expect(ifArray([{ type: "has_permission", perm: "vip" }])).toEqual({
      conds: [{ type: "has_permission", perm: "vip" }],
      joins: [],
    });
  });
});
