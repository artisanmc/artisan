import type { ModelField } from "@/domain/types";
import type { DeclaredAction } from "@/lib/api/declaredActions";
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
