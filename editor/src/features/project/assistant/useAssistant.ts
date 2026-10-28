import {
  type AiEvent,
  type AiStatus,
  createAiConversation,
  getAiStatus,
  readAiConversation,
  sendAiMessage,
} from "@/lib/api/ai";
import { ApiError } from "@/lib/api/client";
import { useCallback, useEffect, useRef, useState } from "react";

/** How often the panel asks for new events while the assistant answers. */
export const POLL_MS = 800;

let status: Promise<AiStatus> | undefined;

/** Whether the hub has an assistant this player may use; asked once per page. */
export function useAiStatus(): AiStatus | undefined {
  const [value, setValue] = useState<AiStatus>();
  useEffect(() => {
    status ??= getAiStatus().catch(() => ({ enabled: false, model: null, canUse: false }));
    let live = true;
    void status.then((s) => live && setValue(s));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/** Forgets the cached status (tests, sign-in change). */
export function resetAiStatus() {
  status = undefined;
}

/**
 * One conversation with the assistant for [project]: started at the first message, polled while
 * the hub runs the turn. A restart of the hub ends it: the next message starts a new one.
 */
export function useAssistant(project: string | null) {
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const id = useRef<string | null>(null);
  const seen = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poll = useCallback(async () => {
    if (!id.current) return;
    try {
      const read = await readAiConversation(id.current, seen.current);
      seen.current += read.events.length;
      if (read.events.length) setEvents((current) => [...current, ...read.events]);
      setRunning(read.running);
      if (read.running) timer.current = setTimeout(() => void poll(), POLL_MS);
    } catch (e) {
      setRunning(false);
      // The hub restarted: the conversation is gone, the next message starts another.
      if (e instanceof ApiError && e.code === "not_found") id.current = null;
      setFailure(e instanceof ApiError ? e.code : "network_error");
    }
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const send = useCallback(
    async (text: string) => {
      setFailure(null);
      try {
        if (!id.current) {
          id.current = (await createAiConversation(project)).id;
          seen.current = 0;
          setEvents([]);
        }
        await sendAiMessage(id.current, text);
        setRunning(true);
        clearTimeout(timer.current);
        await poll();
      } catch (e) {
        setFailure(e instanceof ApiError ? e.code : "network_error");
      }
    },
    [poll, project],
  );

  /** A new conversation: the next message starts it. */
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    id.current = null;
    seen.current = 0;
    setEvents([]);
    setRunning(false);
    setFailure(null);
  }, []);

  return { events, running, failure, send, reset };
}
