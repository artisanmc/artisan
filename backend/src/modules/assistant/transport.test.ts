import { describe, expect, it } from "bun:test";
import OpenAI from "openai";
import { startAssistantHeartbeat, assistantFailureCode } from "./transport";

describe("assistant transport", () => {
  it("keeps a silent stream alive and stops on completion", async () => {
    let writes = 0;
    const stop = startAssistantHeartbeat({ writeSSE: async () => { writes++; }, onAbort: () => {} }, () => {}, 5);
    await Bun.sleep(25);
    expect(writes).toBeGreaterThan(0);
    stop();
    const previous = writes;
    await Bun.sleep(20);
    expect(writes).toBe(previous);
  });

  it("stops and reports a closed SSE once without throwing", async () => {
    let close: () => void = () => {};
    let closed = 0;
    let writes = 0;
    const stop = startAssistantHeartbeat({
      writeSSE: async () => { writes++; }, onAbort: (callback) => { close = callback; },
    }, () => { closed++; }, 5);
    close(); close();
    await Bun.sleep(20);
    expect(closed).toBe(1);
    expect(writes).toBe(0);
    stop();
  });

  it("does not queue heartbeats behind a backpressured write", async () => {
    let release: () => void = () => {};
    let writes = 0;
    const stop = startAssistantHeartbeat({
      writeSSE: () => { writes++; return new Promise<void>((resolve) => { release = resolve; }); },
      onAbort: () => {},
    }, () => {}, 5);
    await Bun.sleep(25);
    expect(writes).toBe(1);
    stop(); release();
  });

  it("classifies SDK failures without exposing provider messages or sources", () => {
    expect(assistantFailureCode(new OpenAI.APIConnectionTimeoutError())).toBe("provider_timeout");
    expect(assistantFailureCode(new OpenAI.APIConnectionError({ message: "secret source" }))).toBe("provider_network_error");
    expect(assistantFailureCode(new OpenAI.APIError(500, {}, "secret source", new Headers()))).toBe("provider_error");
    expect(assistantFailureCode(new Error("secret source"))).toBe("engine_error");
  });
});
