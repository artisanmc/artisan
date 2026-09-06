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
  const attachedFiles = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [
    i === 0 ? "local.yml" : `server:zmenu/menu-${i}.yml`, `title: menu-${i}`,
  ]));

  it("rejects an answer ignoring 30 attachments after one correction attempt", async () => {
    const messages: import("./provider/types").LlmMessage[] = [{ role: "user", content: "Migrate these files" }];
    let calls = 0;
    const provider: LlmProvider = {
      async *streamTurn({ messages: incoming }) {
        if (calls++ === 1) expect(JSON.stringify(incoming)).toContain("read_attachment");
        yield { type: "text", text: "An unfounded answer" };
        yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } };
        yield { type: "done", stopReason: "stop" };
      },
    };
    const events = await collect(runTurn({ provider, model: "m", messages, wc: new WorkingCopy([], attachedFiles) }));
    expect(calls).toBe(2);
    expect(events.filter((e) => e.type === "text")).toEqual([]);
    expect(events.filter((e) => e.type === "usage")).toHaveLength(2);
    expect(events.find((e) => e.type === "error").message).toContain("0/30");
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "attachments_not_read" });
    expect(messages).toEqual([{ role: "user", content: "Migrate these files" }]);
  });

  it("recovers by reading all local and server attachments in parallel before answering", async () => {
    let calls = 0;
    const messages: import("./provider/types").LlmMessage[] = [{ role: "user", content: "Migrate" }];
    const provider: LlmProvider = {
      async *streamTurn({ messages: incoming }) {
        const call = calls++;
        if (call === 0) yield { type: "text", text: "Ignored files" };
        else if (call === 1) {
          for (const id of Object.keys(attachedFiles)) {
            yield { type: "tool_use", id, name: "read_attachment", input: { file_id: id } };
          }
        } else {
          for (const content of Object.values(attachedFiles)) expect(incoming.some((m) => m.role === "tool" && m.content === content)).toBe(true);
          yield { type: "text", text: "Grounded answer" };
        }
        yield { type: "done", stopReason: call === 1 ? "tool_calls" : "stop" };
      },
    };
    const events = await collect(runTurn({ provider, model: "m", messages, wc: new WorkingCopy([], attachedFiles) }));
    expect(calls).toBe(3);
    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "Grounded answer" }]);
    expect(events.filter((e) => e.type === "tool" && e.ok)).toHaveLength(30);
    expect(messages.some((m) => m.role === "system")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "stop" });
  });

  it("reports the incomplete attachment count at the iteration cap", async () => {
    let calls = 0;
    const provider: LlmProvider = {
      async *streamTurn() {
        const id = Object.keys(attachedFiles)[calls++];
        yield { type: "tool_use", id, name: "read_attachment", input: { file_id: id } };
        yield { type: "done", stopReason: "tool_calls" };
      },
    };
    const events = await collect(runTurn({ provider, model: "m", messages: [], wc: new WorkingCopy([], attachedFiles) }));
    expect(calls).toBe(25);
    expect(events.find((e) => e.type === "error").message).toContain("25/30");
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "attachments_not_read" });
  });

  it("does not count failed reads or execute writes in the same batch as initial reads", async () => {
    const provider = scriptedProvider([
      [
        { type: "tool_use", id: "bad-read", name: "read_attachment", input: { file_id: "missing.yml" } },
        { type: "tool_use", id: "read", name: "read_attachment", input: { file_id: "local.yml" } },
        { type: "tool_use", id: "write", name: "upsert_menu", input: { menu: validMenu } },
        { type: "tool_use", id: "translate", name: "write_translations", input: { entries: { k: { en: "Shop" } } } },
        { type: "done", stopReason: "tool_calls" },
      ],
      [{ type: "tool_use", id: "write-after-reading", name: "upsert_menu", input: { menu: validMenu } }, { type: "done", stopReason: "tool_calls" }],
      [{ type: "text", text: "Done" }, { type: "done", stopReason: "stop" }],
    ]);
    const events = await collect(runTurn({ provider, model: "m", messages: [], wc: new WorkingCopy([], { "local.yml": "content" }) }));
    expect(events.filter((e) => e.type === "tool" && !e.ok).map((e) => e.name)).toEqual(["read_attachment", "upsert_menu", "write_translations"]);
    expect(events.filter((e) => e.type === "menu_written")).toHaveLength(1);
    expect(events.some((e) => e.type === "translations_written")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "stop" });
  });

  it("cannot satisfy the read requirement using a missing attachment", async () => {
    const provider = scriptedProvider([
      [{ type: "tool_use", id: "bad", name: "read_attachment", input: { file_id: "missing.yml" } }, { type: "done", stopReason: "tool_calls" }],
      [{ type: "text", text: "Unfounded" }, { type: "done", stopReason: "stop" }],
      [{ type: "text", text: "Still unfounded" }, { type: "done", stopReason: "stop" }],
    ]);
    const events = await collect(runTurn({ provider, model: "m", messages: [], wc: new WorkingCopy([], { "local.yml": "" }) }));
    expect(events.filter((e) => e.type === "text")).toEqual([]);
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "attachments_not_read", readCount: 0, totalCount: 1 });
  });

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
