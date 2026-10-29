import {
  type AiEvent,
  type AiScope,
  createAiConversation,
  readAiConversation,
  sendAiMessage,
} from "@/lib/api/ai";
import { ApiError } from "@/lib/api/client";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";

/** How often a view asks for new events while the assistant answers. */
export const POLL_MS = 800;

export { resetAiStatus, useAiStatus } from "@/state/aiStatus";

/** A conversation as the editor has read it so far. */
export interface ConversationView {
  events: AiEvent[];
  running: boolean;
  failure: string | null;
  /** The hub no longer has it (it restarted): the next message starts another. */
  gone: boolean;
}

const EMPTY: ConversationView = { events: [], running: false, failure: null, gone: false };

interface ConversationsState {
  byId: Record<string, ConversationView>;
  /**
   * The conversation the docked panel and the Assistant tab both show: "Expand" carries it from
   * one to the other. Null: the next message starts one.
   */
  currentId: string | null;
}

/**
 * The conversations read from the hub, shared by every view of them (ADR `editor-assistant`):
 * the dock and the server's Assistant tab show the same events, polled once.
 */
export const useConversationsStore = create<ConversationsState>(() => ({
  byId: {},
  currentId: null,
}));

export const setCurrentConversation = (id: string | null) =>
  useConversationsStore.setState({ currentId: id });

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const reading = new Set<string>();
const again = new Set<string>();

function patch(id: string, next: Partial<ConversationView>) {
  useConversationsStore.setState((s) => ({
    byId: { ...s.byId, [id]: { ...(s.byId[id] ?? EMPTY), ...next } },
  }));
}

/**
 * Reads what is new in [id] and keeps reading while the assistant answers. One read at a time per
 * conversation: a call meanwhile reads again once it ends.
 */
export async function followConversation(id: string): Promise<void> {
  if (reading.has(id)) {
    again.add(id);
    return;
  }
  reading.add(id);
  clearTimeout(timers.get(id));
  try {
    const seen = useConversationsStore.getState().byId[id]?.events.length ?? 0;
    const read = await readAiConversation(id, seen);
    const current = useConversationsStore.getState().byId[id]?.events ?? [];
    patch(id, {
      events: read.events.length ? [...current, ...read.events] : current,
      running: read.running,
    });
    if (read.running)
      timers.set(
        id,
        setTimeout(() => void followConversation(id), POLL_MS),
      );
  } catch (e) {
    patch(id, {
      running: false,
      failure: e instanceof ApiError ? e.code : "network_error",
      ...(e instanceof ApiError && e.code === "not_found" ? { gone: true } : {}),
    });
  } finally {
    reading.delete(id);
    if (again.delete(id)) void followConversation(id);
  }
}

/** Forgets every conversation read (sign-out, tests). */
export function resetConversations() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  reading.clear();
  again.clear();
  useConversationsStore.setState({ byId: {}, currentId: null });
}

/**
 * The current conversation, for a view that talks in it: its events as they come, and [send],
 * which starts one in [scope] when there is none.
 */
export function useAssistant(scope: AiScope) {
  const id = useConversationsStore((s) => s.currentId);
  const view = useConversationsStore((s) => (id ? s.byId[id] : undefined)) ?? EMPTY;
  const [sendFailure, setSendFailure] = useState<string | null>(null);
  const { project = null, server = null } = scope;

  // A conversation picked elsewhere (the tab's list) is read once it shows.
  useEffect(() => {
    if (id && !useConversationsStore.getState().byId[id]) void followConversation(id);
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another conversation, another error.
  useEffect(() => setSendFailure(null), [id]);

  const send = useCallback(
    async (text: string) => {
      setSendFailure(null);
      try {
        let target = useConversationsStore.getState().currentId;
        if (!target || useConversationsStore.getState().byId[target]?.gone) {
          target = (await createAiConversation({ project, server })).id;
          patch(target, {});
          setCurrentConversation(target);
        }
        await sendAiMessage(target, text);
        patch(target, { running: true, failure: null });
        await followConversation(target);
      } catch (e) {
        setSendFailure(e instanceof ApiError ? e.code : "network_error");
      }
    },
    [project, server],
  );

  /** A new conversation: the next message starts it. */
  const reset = useCallback(() => {
    setSendFailure(null);
    setCurrentConversation(null);
  }, []);

  return {
    id,
    events: view.events,
    running: view.running,
    failure: sendFailure ?? view.failure,
    send,
    reset,
  };
}
