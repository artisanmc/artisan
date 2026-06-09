import { describe, expect, it } from "bun:test";
import { createProvider, resolveProviderConfig } from "./config";

const run = process.env.ASSISTANT_SMOKE === "1";

describe.skipIf(!run)("provider smoke (real network)", () => {
  it("streams a tool call from the configured provider", async () => {
    const cfg = resolveProviderConfig(process.env)!;
    const provider = createProvider(cfg);
    // biome-ignore lint/suspicious/noExplicitAny: collected stream events
    const events: any[] = [];
    for await (const e of provider.streamTurn({
      messages: [{ role: "user", content: 'Call the tool ping with {"x":1}.' }],
      tools: [
        {
          name: "ping",
          description: "Ping with a number",
          parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
        },
      ],
      model: cfg.model,
    })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
