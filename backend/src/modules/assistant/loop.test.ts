import { describe, expect, it } from "bun:test";
import { runTurn } from "./loop";
import { WorkingCopy } from "./workingCopy";
import type { LlmProvider, LlmStreamEvent } from "./provider/types";

function scriptedProvider(turns: LlmStreamEvent[][]): LlmProvider {
  let i = 0;
  return {
    async *streamTurn() {
      const t = turns[i++] ?? [{ type: "done", stopReason: "end_turn" }];
      for (const e of t) yield e;
    },
  };
}
const validMenu = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", material: "STONE" }] }],
};
async function collect(it: AsyncIterable<any>) { const o: any[] = []; for await (const e of it) o.push(e); return o; }

describe("runTurn", () => {
  it("self-corrects after an invalid upsert, then writes the menu", async () => {
    const provider = scriptedProvider([
      // turn 1: invalid upsert (size 13)
      [{ type: "tool_use", id: "c1", name: "upsert_menu", input: { menu: { ...validMenu, size: 13 } } }, { type: "done", stopReason: "tool_calls" }],
      // turn 2: corrected upsert
      [{ type: "tool_use", id: "c2", name: "upsert_menu", input: { menu: validMenu } }, { type: "done", stopReason: "tool_calls" }],
      // turn 3: final text, no tools
      [{ type: "text", text: "Done." }, { type: "done", stopReason: "end_turn" }],
    ]);
    const wc = new WorkingCopy();
    const messages: any[] = [{ role: "user", content: "make a shop" }];
    const events = await collect(runTurn({ provider, model: "m", messages, wc }));

    const failTool = events.find((e) => e.type === "tool" && e.ok === false);
    expect(failTool).toBeTruthy();
    expect(events.some((e) => e.type === "menu_written")).toBe(true);
    expect(wc.get("shop")).toBeTruthy();
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("prepends a fresh system prompt for the provider call without persisting it", async () => {
    let seen: { role: string }[] = [];
    const provider: LlmProvider = {
      async *streamTurn({ messages }) {
        seen = messages.map((m) => ({ role: m.role }));
        yield { type: "text", text: "ok" };
        yield { type: "done", stopReason: "end_turn" };
      },
    };
    const messages: any[] = [{ role: "user", content: "hi" }];
    await collect(runTurn({ provider, model: "m", messages, wc: new WorkingCopy(), system: "SYS" }));

    // Provider saw the system prefix then the user message.
    expect(seen[0]).toEqual({ role: "system" });
    expect(seen[1]).toEqual({ role: "user" });
    // The persisted history never gained the grounding system message.
    expect(messages.some((m) => m.role === "system")).toBe(false);
    expect(messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("stops at the iteration cap if the model never stops calling tools", async () => {
    const loopTurn: LlmStreamEvent[] = [{ type: "tool_use", id: "x", name: "list_menus", input: {} }, { type: "done", stopReason: "tool_calls" }];
    const provider: LlmProvider = { async *streamTurn() { for (const e of loopTurn) yield e; } };
    const events = await collect(runTurn({ provider, model: "m", messages: [{ role: "user", content: "loop" }], wc: new WorkingCopy(), maxIterations: 3 }));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "max_iterations" });
  });
});
