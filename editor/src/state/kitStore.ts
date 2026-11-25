import { THEMES_CONFIG_KEY, configuredThemes } from "@/lib/pack/theme";
import { create } from "zustand";

/** The Project of the server's common images (the theme `artisan`) as it is published: the files its kit images are read from. */
export interface KitRead {
  /** The module's project id, which its binaries are fetched under. */
  projectId: string;
  files: Record<string, string>;
  binaries: { path: string; hash: string }[];
  /**
   * Whether the server reads a common image by its name alone: it has the theme `artisan`. An
   * older one, whose common images are the module `ui-kit`, reads `kit:<name>` only.
   */
  byName?: boolean;
}

interface KitState {
  /** `undefined`: the server has no kit module, or its projects are not read yet. */
  read: KitRead | undefined;
  setRead: (read: KitRead | undefined) => void;
  /**
   * The server's themes that are a folder of their own (`themes/<name>/`, a Project of that
   * name), by name, as published. A theme the common images' Project still keeps is not here:
   * it is read from `read`.
   */
  own: Readonly<Record<string, KitRead>>;
  setOwn: (own: Readonly<Record<string, KitRead>>) => void;
  /**
   * The themes in place on the server, the lowest first (`resource-pack.themes`): what its pack
   * is built in. Empty: none, or not read yet. The array changes only when the names do.
   */
  themes: readonly string[];
  /**
   * Whether the server's `config.yml` holds the list of themes; `false` on an older one, which
   * has one theme in place at most (`resource-pack.theme`).
   */
  stacks: boolean;
  /** Reads both from the server's `config.yml` as its plugin reports it; `null`: not read. */
  readConfig: (config: Record<string, unknown> | null | undefined) => void;
}

const NO_THEMES: readonly string[] = [];
const NO_OWN: Readonly<Record<string, KitRead>> = {};

/**
 * What the server index knows of the kit module, held here so that whatever draws a menu can
 * show a `kit:<name>` image without depending on the index itself.
 */
export const useKitStore = create<KitState>((set) => ({
  read: undefined,
  setRead: (read) => set({ read }),
  own: NO_OWN,
  setOwn: (own) => set({ own: Object.keys(own).length === 0 ? NO_OWN : own }),
  themes: NO_THEMES,
  stacks: false,
  readConfig: (config) =>
    set((state) => {
      const themes = configuredThemes(config);
      const same =
        themes.length === state.themes.length &&
        themes.every((name, i) => name === state.themes[i]);
      return {
        stacks: !!config && THEMES_CONFIG_KEY in config,
        themes: same ? state.themes : themes.length === 0 ? NO_THEMES : themes,
      };
    }),
}));
