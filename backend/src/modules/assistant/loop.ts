import type { LlmMessage, LlmProvider } from "./provider/types";
import { LlmRequestError } from "./provider/types";
import { TOOL_DEFS, executeTool, type EngineEvent } from "./tools";
import type { WorkingCopy } from "./workingCopy";

export async function* runTurn(args: {
  provider: LlmProvider;
  model: string;
  messages: LlmMessage[]; // mutated in place across iterations (history + this user msg); never holds the grounding
  wc: WorkingCopy;
  maxIterations?: number;
  signal?: AbortSignal;
  activity?: boolean;
  beforeIteration?: () => Promise<void>;
  system?: string; // grounding prompt, prepended fresh per call — NOT persisted into `messages`
}): AsyncIterable<EngineEvent> {
  const { provider, model, messages, wc, system } = args;
  const maxIterations = args.maxIterations ?? 25;
  const tools = TOOL_DEFS;
  const attachmentIds = wc.attachmentIds();
  const unread = new Set(args.activity ? [] : attachmentIds);
  let correctionAttempted = false;
  let reminder: LlmMessage | undefined;
  const incompleteError = (): EngineEvent => ({
    type: "error",
    code: "attachments_not_read",
    readCount: attachmentIds.length - unread.size,
    totalCount: attachmentIds.length,
    message: `Attachment reading incomplete (${attachmentIds.length - unread.size}/${attachmentIds.length}). Please retry.`,
  });

  for (let i = 0; i < maxIterations; i++) {
    args.signal?.throwIfAborted();
    await args.beforeIteration?.();
    if (args.activity) yield { type: "activity", name: "model" };
    let text = "";
    let reasoning = "";
    const toolCalls: { id: string; name: string; input: unknown }[] = [];
    let stop = "end_turn";
    const awaitingAttachments = unread.size > 0;

    // Rebuilt each iteration so the growing in-place history (new tool results)
    // is included, while the grounding is prepended fresh and never persisted.
    const callMessages: LlmMessage[] = [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...messages,
      ...(reminder ? [reminder] : []),
    ];
    for await (const ev of provider.streamTurn({
      messages: callMessages,
      tools,
      model,
      signal: args.signal,
      includeReasoning: args.activity,
      requireExplicitFinish: args.activity,
      maxResponseBytes: args.activity ? 8 * 1024 * 1024 : undefined,
    })) {
      args.signal?.throwIfAborted();
      if (ev.type === "text") {
        text += ev.text;
        if (!awaitingAttachments) yield ev;
      } else if (ev.type === "reasoning") {
        reasoning += ev.text;
        yield ev;
      } else if (ev.type === "tool_use")
        toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
      else if (ev.type === "usage") yield ev;
      else if (ev.type === "done") stop = ev.stopReason;
    }
    if (["length", "max_tokens"].includes(stop))
      throw new LlmRequestError("provider_output_limit");

    if (toolCalls.length === 0 && awaitingAttachments) {
      if (!correctionAttempted) {
        correctionAttempted = true;
        reminder = {
          role: "system",
          content: `Before answering, use read_attachment for every remaining file_id: ${JSON.stringify([...unread])}. Call these tools in parallel in your next response. Do not answer or modify the project before reading their results.`,
        };
        continue;
      }
      yield incompleteError();
      yield { type: "done", stopReason: "attachments_not_read" };
      return;
    }
    reminder = undefined;

    messages.push({
      role: "assistant",
      content: awaitingAttachments ? null : text || null,
      ...(reasoning ? { reasoningContent: reasoning } : {}),
      ...(toolCalls.length > 0
        ? {
            toolCalls: toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            })),
          }
        : {}),
    });

    if (toolCalls.length === 0) {
      yield { type: "done", stopReason: stop };
      return;
    }

    const answered = new Set<string>();
    try {
      for (const tc of toolCalls) {
        args.signal?.throwIfAborted();
        if (args.activity) {
          const input = tc.input as Record<string, unknown> | null;
          const target =
            input && typeof input === "object"
              ? (input.file_id ?? input.id)
              : undefined;
          yield {
            type: "activity",
            name: tc.name,
            ...(typeof target === "string"
              ? { target: target.slice(0, 256) }
              : {}),
          };
        }
        // A model cannot have used results of reads requested in this same batch.
        const mutatesProject =
          tc.name.startsWith("upsert_") ||
          tc.name.startsWith("delete_") ||
          tc.name === "write_translations";
        const res =
          awaitingAttachments && mutatesProject
            ? {
                ok: false,
                content:
                  "Read all attached files with read_attachment and inspect their results before modifying the project.",
              }
            : executeTool(tc.name, tc.input, wc);
        if (tc.name === "read_attachment" && res.ok) {
          const input = tc.input as { file_id: string };
          unread.delete(input.file_id);
        }
        messages.push({
          role: "tool",
          toolCallId: tc.id,
          content: res.content,
        });
        answered.add(tc.id);
        if (res.event) yield res.event;
        yield {
          type: "tool",
          name: tc.name,
          ok: res.ok,
          detail: res.ok ? undefined : res.content,
        };
      }
    } finally {
      for (const tc of toolCalls)
        if (!answered.has(tc.id))
          messages.push({
            role: "tool",
            toolCallId: tc.id,
            isError: true,
            content:
              "Not executed: the task was interrupted. Existing proposals are retained; continue only on user request.",
          });
    }
    // loop: re-streamTurn with the appended tool results
  }

  if (unread.size > 0) {
    yield incompleteError();
    yield { type: "done", stopReason: "attachments_not_read" };
    return;
  }
  yield {
    type: "error",
    message: `Reached the ${maxIterations}-iteration cap.`,
  };
  yield { type: "done", stopReason: "max_iterations" };
}
