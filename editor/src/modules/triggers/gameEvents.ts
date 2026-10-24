import type { ModelField } from "@/domain/types";
import { type GameEvent, gameEventFromWire } from "@/lib/api/gameEvents";
import type { PlaceholderEntry, PlaceholderType } from "@/lib/placeholderCatalog";
import { useServerGameEventsStore } from "@/state/serverGameEventsStore";
import { useMemo } from "react";
import vector from "../../../../testdata/core-game-events.json";

/**
 * Artisan's catalog of Game events, as the plugin declares it (`CoreGameEvents.kt`): the
 * shared file `testdata/core-game-events.json` is generated from it and kept equal by
 * `CoreGameEventsVectorTest`, so the picker works without a server.
 */
export const CORE_GAME_EVENTS: readonly GameEvent[] = (
  vector.events as Parameters<typeof gameEventFromWire>[0][]
).flatMap((w) => gameEventFromWire(w) ?? []);

/** The picker's domains, in the order it lists them; a module's events come after, by module. */
export const EVENT_GROUPS = [
  "connection",
  "life",
  "world",
  "blocks",
  "items",
  "combat",
  "progression",
  "commands",
] as const;

/**
 * The events a Trigger may listen to: the core catalog, then what the active server
 * declares (its own copy of a core event wins, a module's events are added).
 */
export function mergeGameEvents(server: readonly GameEvent[]): GameEvent[] {
  const byName = new Map<string, GameEvent>(CORE_GAME_EVENTS.map((e) => [e.name, e]));
  for (const e of server) byName.set(e.name, e);
  return [...byName.values()];
}

/**
 * {@link mergeGameEvents} over the active server's events. `serverNames` are the events the
 * server announced: once it answered (`serverReady`), an event outside it is one the
 * server will not fire (its module is not installed there).
 */
export function useGameEvents(): {
  events: GameEvent[];
  serverReady: boolean;
  serverNames: Set<string>;
} {
  const server = useServerGameEventsStore((s) => s.events);
  const status = useServerGameEventsStore((s) => s.status);
  return useMemo(
    () => ({
      events: mergeGameEvents(server),
      serverReady: status === "ready",
      serverNames: new Set(server.map((e) => e.name)),
    }),
    [server, status],
  );
}

/** The event named `name` among `events`, or undefined (a module not installed). */
export function findGameEvent(events: readonly GameEvent[], name: string): GameEvent | undefined {
  return events.find((e) => e.name === name);
}

function placeholderType(field: ModelField): PlaceholderType {
  switch (field.type.kind) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "list":
      return "list";
    case "object":
      return "object";
    default:
      return "string";
  }
}

/**
 * The `{event.…}` values of an event, one per leaf (`event.location.x`), plus each object
 * itself (`event.location`) and `event.cancelled` for a cancellable event: what the
 * placeholder catalog offers in the Trigger's texts, and the chips of its page.
 */
export function eventContextEntries(event: GameEvent): PlaceholderEntry[] {
  const out: PlaceholderEntry[] = [];
  const walk = (fields: ModelField[], prefix: string) => {
    for (const f of fields) {
      const path = `${prefix}.${f.name}`;
      out.push({ path, type: placeholderType(f), sample: null, origin: "context" });
      if (f.type.kind === "object") walk(f.type.fields, path);
    }
  };
  walk(event.context, "event");
  if (event.cancellable)
    out.push({ path: "event.cancelled", type: "boolean", sample: null, origin: "context" });
  return out;
}
