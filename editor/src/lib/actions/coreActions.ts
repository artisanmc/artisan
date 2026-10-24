import type { ModelField } from "@/domain/types";
import type { DeclaredAction } from "@/lib/api/declaredActions";
import { CORE_GAME_EVENTS } from "@/modules/triggers/gameEvents";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useCallback } from "react";
import vector from "../../../../testdata/core-actions.json";

/**
 * Artisan's own action vocabulary, as the plugin declares it (`CoreActions.kt`): the
 * shared file `testdata/core-actions.json` is generated from the Kotlin schemas and kept
 * equal to them by `CoreActionsVectorTest`, so the editor never carries a hand-written copy
 * of a core action's arguments. Same shape as a server's `declared_actions`, `moduleId`
 * null; `i18nSlots` adds the legacy text slots the DSL addressing counts.
 */
interface CoreActionEntry {
  name: string;
  args: unknown[];
  primary: string | null;
  i18n_slots?: Record<string, string>;
}

export const CORE_ACTIONS: readonly DeclaredAction[] = (vector.actions as CoreActionEntry[]).map(
  (a) => ({
    name: a.name,
    args: a.args as ModelField[],
    primary: a.primary ?? null,
    moduleId: null,
    ...(a.i18n_slots ? { i18nSlots: a.i18n_slots } : {}),
  }),
);

const CORE_BY_NAME = new Map(CORE_ACTIONS.map((a) => [a.name, a]));

export function coreActionOf(name: string): DeclaredAction | undefined {
  return CORE_BY_NAME.get(name);
}

export const isCoreAction = (name: string): boolean => CORE_BY_NAME.has(name);

/** How a declaration is found by name: the core table first, then whatever the caller adds. */
export type DeclaredActionLookup = (name: string) => DeclaredAction | undefined;

/** Effect names the core catalog declares as a flag or a number: never a text, even as a template string. */
const NON_TEXT_EFFECTS: ReadonlySet<string> = new Set(
  CORE_GAME_EVENTS.flatMap((e) => e.effects)
    .filter(
      (f) => f.type.kind === "boolean" || f.type.kind === "integer" || f.type.kind === "number",
    )
    .map((f) => f.name),
);

/**
 * `set_event` declares no argument: its map is `{<effect>: value}` for whichever event the
 * Trigger listens to. Its declaration is read off the value instead, so that its texts are
 * translated like any action text (`…set_event.join_message`): a flag or a number is kept as
 * is, every other value is a text.
 */
export function setEventDeclaration(value: unknown): DeclaredAction {
  const entries =
    value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
  return {
    name: "set_event",
    args: entries.map(([name, v]): ModelField => {
      if (typeof v === "boolean") return { name, type: { kind: "boolean" } };
      if (typeof v === "number") return { name, type: { kind: "number" } };
      if (typeof v === "string" && NON_TEXT_EFFECTS.has(name))
        return { name, type: { kind: "string" } };
      return { name, type: { kind: "ltext" } };
    }),
    primary: null,
    moduleId: "triggers",
  };
}

/** An action's declaration: by its name, or read off its value for `set_event`. */
export function declarationOfAction(
  action: { name: string; value: unknown },
  declOf: DeclaredActionLookup,
): DeclaredAction | undefined {
  return action.name === "set_event" ? setEventDeclaration(action.value) : declOf(action.name);
}

/**
 * A declaration by name: Artisan's own, or one the active server registered (store
 * `serverActionsStore`). Undefined for a name nobody declared — a module the server
 * does not run, or a typo: its texts have no i18n site and its form is edited as JSON.
 */
export const declaredActionOf: DeclaredActionLookup = (name) =>
  coreActionOf(name) ?? useServerActionsStore.getState().actions.find((a) => a.name === name);

/** The same lookup as a hook: re-renders when the server's declared actions change. */
export function useDeclaredActionOf(): DeclaredActionLookup {
  const actions = useServerActionsStore((s) => s.actions);
  return useCallback(
    (name: string) => coreActionOf(name) ?? actions.find((a) => a.name === name),
    [actions],
  );
}
