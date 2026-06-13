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

describe("makeStepConverter", () => {
  it("converts a flat open_menu action", () => {
    const c = ctx();
    const { action } = makeStepConverter(c);
    expect(action({ type: "open_menu", menu_id: "shop" })).toEqual({ type: "open_menu", menuId: "shop" });
  });

  it("converts an if-step with conditions and nested actions", () => {
    const c = ctx();
    const { step } = makeStepConverter(c);
    const s = step({
      kind: "if",
      cases: [
        { conditions: [{ type: "has_permission", perm: "a.b" }], steps: [{ kind: "action", action: { type: "close_menu" } }] },
      ],
    });
    expect(s).toEqual({
      kind: "if",
      cases: [{ conditions: [{ type: "has_permission", perm: "a.b" }], steps: [{ kind: "action", action: { type: "close_menu" } }] }],
    });
  });

  it("records unsupported action types", () => {
    const c = ctx();
    const { action } = makeStepConverter(c);
    expect(action({ type: "bogus" })).toBeNull();
    expect(c.unsupported).toContain("action: bogus");
  });

  it("converts send_message text through the i18n bridge", () => {
    const c = ctx();
    const { action } = makeStepConverter(c);
    const a = action({ type: "send_message", text: "hi" }) as any;
    expect(c.keys[a.text.key]).toEqual({ en: "hi" });
  });
});
