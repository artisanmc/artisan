import type { GameEvent } from "@/lib/api/gameEvents";
import { createContext, useContext } from "react";

/**
 * `cancel_event` and `set_event` (ADR `triggers-and-variables` §3 bis): the two actions that
 * change the Game event whose Trigger is running. The plugin's `triggers` module declares
 * them like a module's actions; the editor offers them only in a Trigger's chain, from the
 * chosen event's declaration (cancellable, effects), never in the generic step picker.
 */
export const EVENT_ACTIONS: ReadonlySet<string> = new Set(["cancel_event", "set_event"]);

export const isEventAction = (name: string): boolean => EVENT_ACTIONS.has(name);

/**
 * The Game event of the chain being edited: set by a Trigger's page around its chain,
 * absent everywhere else (a menu, a command), where the event actions have nothing to act on.
 */
const ChainEventContext = createContext<GameEvent | null>(null);
export const ChainEventProvider = ChainEventContext.Provider;
export const useChainEvent = (): GameEvent | null => useContext(ChainEventContext);

/** The `set_event` argument map of a step value, `{}` when it is not one. */
export function setEventArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
