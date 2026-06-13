import type { LlmMessage, LlmProvider } from "./provider/types";
import { TOOL_DEFS, executeTool, type EngineEvent } from "./tools";
import type { WorkingCopy } from "./workingCopy";

export async function* runTurn(args: {
  provider: LlmProvider;
  model: string;
  messages: LlmMessage[]; // mutated in place across iterations (history + this user msg); never holds the grounding
  wc: WorkingCopy;
  maxIterations?: number;
  system?: string; // grounding prompt, prepended fresh per call — NOT persisted into `messages`
}): AsyncIterable<EngineEvent> {
  const { provider, model, messages, wc, system } = args;
  const maxIterations = args.maxIterations ?? 25;

  for (let i = 0; i < maxIterations; i++) {
    let text = "";
    const toolCalls: { id: string; name: string; input: unknown }[] = [];
    let stop = "end_turn";

    // Rebuilt each iteration so the growing in-place history (new tool results)
    // is included, while the grounding is prepended fresh and never persisted.
    const callMessages: LlmMessage[] = system
      ? [{ role: "system", content: system }, ...messages]
      : messages;
    for await (const ev of provider.streamTurn({ messages: callMessages, tools: TOOL_DEFS, model })) {
      if (ev.type === "text") { text += ev.text; yield ev; }
      else if (ev.type === "tool_use") toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
      else if (ev.type === "usage") yield ev;
      else if (ev.type === "done") stop = ev.stopReason;
    }

    messages.push({
      role: "assistant",
      content: text || null,
      ...(toolCalls.length > 0
        ? { toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.input) })) }
        : {}),
    });

    if (toolCalls.length === 0) { yield { type: "done", stopReason: stop }; return; }

    for (const tc of toolCalls) {
      const res = executeTool(tc.name, tc.input, wc);
      if (res.event) yield res.event;
      yield { type: "tool", name: tc.name, ok: res.ok, detail: res.ok ? undefined : res.content };
      messages.push({ role: "tool", toolCallId: tc.id, content: res.content });
    }
    // loop: re-streamTurn with the appended tool results
  }

  yield { type: "error", message: `Reached the ${maxIterations}-iteration cap.` };
  yield { type: "done", stopReason: "max_iterations" };
}
