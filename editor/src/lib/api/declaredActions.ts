import type { ModelField } from "@/domain/types";
import { apiFetch } from "./client";

/**
 * An action registered on a server (ADR `extensible-document-kinds`, R1): Artisan's own
 * (`module_id` absent) or a module's, with the typed arguments its form shows and the
 * argument the scalar wire form binds. Wire verbatim from `declared_actions` at Presence.
 */
export interface DeclaredAction {
  name: string;
  args: ModelField[];
  primary: string | null;
  moduleId: string | null;
  /**
   * Legacy i18n slot of a text argument (argument name → slot), core actions only: the
   * positional addressing of the Action DSL counts `send_message`/`broadcast` texts as
   * `message`, `show_title` as `show_title`/`show_subtitle` (`domain/actionTextSlots.ts`).
   */
  i18nSlots?: Record<string, string>;
}

/** Declared actions of a server. [] on any failure. */
export async function fetchServerDeclaredActions(serverId: string): Promise<DeclaredAction[]> {
  try {
    const data = await apiFetch<{
      actions?: {
        name?: string;
        args?: ModelField[];
        primary?: string | null;
        module_id?: string | null;
      }[];
    }>(`/api/v1/servers/${serverId}/actions`);
    return (data.actions ?? [])
      .filter((a) => typeof a.name === "string" && a.name.length > 0)
      .map((a) => ({
        name: a.name as string,
        args: Array.isArray(a.args) ? a.args : [],
        primary: a.primary ?? null,
        moduleId: a.module_id ?? null,
      }));
  } catch {
    return [];
  }
}
