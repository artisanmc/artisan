import type { ModelField } from "@/domain/types";
import { apiFetch } from "./client";

/**
 * A Game event a Trigger may listen to (ADR `triggers-and-variables` §2): Artisan's
 * catalog (`module_id` absent) or a module's own, with the context a chain reads under
 * `{event.…}` and the effects `set_event` may write. Wire verbatim from
 * `declared_game_events` at Presence.
 */
export interface GameEvent {
  name: string;
  /** The domain the picker groups it under (`life`, `blocks`; a module's id). */
  group: string;
  frequency: "rare" | "normal";
  context: ModelField[];
  cancellable: boolean;
  effects: ModelField[];
  moduleId: string | null;
}

interface GameEventWire {
  name?: string;
  group?: string;
  frequency?: string;
  context?: ModelField[];
  cancellable?: boolean;
  effects?: ModelField[];
  module_id?: string | null;
}

/** One `declared_game_events` entry, or null when it has no name. */
export function gameEventFromWire(w: GameEventWire): GameEvent | null {
  if (typeof w.name !== "string" || w.name.length === 0) return null;
  return {
    name: w.name,
    group: typeof w.group === "string" && w.group ? w.group : "other",
    frequency: w.frequency === "normal" ? "normal" : "rare",
    context: Array.isArray(w.context) ? w.context : [],
    cancellable: w.cancellable === true,
    effects: Array.isArray(w.effects) ? w.effects : [],
    moduleId: w.module_id ?? null,
  };
}

/** Game events of a server. [] on any failure. */
export async function fetchServerGameEvents(serverId: string): Promise<GameEvent[]> {
  try {
    const data = await apiFetch<{ game_events?: GameEventWire[] }>(
      `/api/v1/servers/${serverId}/game-events`,
    );
    return (data.game_events ?? []).flatMap((w) => gameEventFromWire(w) ?? []);
  } catch {
    return [];
  }
}
