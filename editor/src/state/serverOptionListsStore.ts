import { type OptionList, fetchServerOptionLists } from "@/lib/api/optionLists";
import { create } from "zustand";

interface OptionListsSource {
  serverId: string;
}

interface ServerOptionListsState {
  lists: OptionList[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: OptionListsSource) => Promise<void>;
}

/**
 * The option lists the installed modules declare on the active server: the choices a module's
 * view offers and only the server knows (a quest group's actor types). Read by a module through
 * the SDK's `useOptionList`.
 */
export const useServerOptionListsStore = create<ServerOptionListsState>((set, get) => ({
  lists: [],
  status: "idle",
  loadedKey: null,
  async load(source: OptionListsSource) {
    const key = `u:${source.serverId}`;
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    const lists = await fetchServerOptionLists(source.serverId);
    if (get().loadedKey !== key) return;
    set({ lists, status: "ready", loadedKey: key });
  },
}));

/** The options of the list `id` in the interface language `lang`, or undefined: not loaded, or not declared. */
export function optionsOf(
  lists: OptionList[],
  id: string,
  lang: string,
): { value: string; label: string }[] | undefined {
  const list = lists.find((l) => l.id === id);
  return list?.options.map((o) => ({
    value: o.value,
    label: o.labels[lang] ?? o.labels.en ?? o.value,
  }));
}
