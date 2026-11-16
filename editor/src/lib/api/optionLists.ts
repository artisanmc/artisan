import { apiFetch } from "./client";

/** One choice of an option list: the value a file holds, and its label by language code. */
export interface OptionListEntry {
  value: string;
  labels: Record<string, string>;
}

/**
 * A closed list of choices a module declares for its editor view (`quests:actor_types`), wire
 * verbatim from `declared_option_lists` at Presence.
 */
export interface OptionList {
  /** `<namespace>:<name>`. */
  id: string;
  options: OptionListEntry[];
}

interface OptionListWire {
  id?: string;
  options?: { value?: unknown; labels?: unknown }[];
}

/** One `declared_option_lists` entry, or null when it has no id. Options without a value are left out. */
export function optionListFromWire(w: OptionListWire): OptionList | null {
  if (typeof w.id !== "string" || !w.id) return null;
  const options = (Array.isArray(w.options) ? w.options : []).flatMap((o) => {
    if (!o || typeof o.value !== "string" || !o.value) return [];
    const labels: Record<string, string> = {};
    if (o.labels && typeof o.labels === "object")
      for (const [lang, label] of Object.entries(o.labels as Record<string, unknown>))
        if (typeof label === "string" && label) labels[lang] = label;
    return [{ value: o.value, labels }];
  });
  return { id: w.id, options };
}

/** The option lists of a server. [] on any failure, and on a server older than the route. */
export async function fetchServerOptionLists(serverId: string): Promise<OptionList[]> {
  try {
    const data = await apiFetch<{ option_lists?: OptionListWire[] }>(
      `/api/v1/servers/${serverId}/option-lists`,
    );
    return (data.option_lists ?? []).flatMap((w) => optionListFromWire(w) ?? []);
  } catch {
    return [];
  }
}
