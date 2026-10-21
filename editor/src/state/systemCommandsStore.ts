import { configRead } from "@/lib/api/configScreens";
import { type PlayerCommand, fetchPlayerCommands } from "@/lib/api/playerCommands";
import { listServerProjects } from "@/lib/api/projectFiles";
import {
  OVERRIDES_DIR,
  type StoredOverride,
  type Texts,
  parseOverride,
} from "@/lib/commandOverride";
import { create } from "zustand";

/** A module folder of the server, as an override target. */
export interface CommandFolder {
  folder: string;
  ownerModule: string | null;
}

interface SystemCommandsState {
  serverId: string | null;
  status: "idle" | "loading" | "ready";
  commands: PlayerCommand[];
  folders: CommandFolder[];
  /** By command id; the first file by folder then path wins, as on the server. */
  overrides: Record<string, StoredOverride>;
  /**
   * Texts edited in the Translations tab and not written yet, whole maps by
   * `commandTextKey`: they outlive a tab switch, not a change of server.
   */
  textDrafts: Record<string, Texts>;
  /** Reads the server's commands and every folder's overrides; [force] re-reads the same server. */
  load: (serverId: string, force?: boolean) => Promise<void>;
  setTextDraft: (key: string, texts: Texts) => void;
  discardTextDrafts: (keys: string[]) => void;
}

/**
 * The commands modules declare on the active server and the admin's overrides of them: the
 * editor's System section (design `framework-commandes` §3.9). The overrides are read from the
 * disk of every module folder, like a Config screen's table, so the list matches what the server
 * applies after its last reload.
 */
export const useSystemCommandsStore = create<SystemCommandsState>((set, get) => ({
  serverId: null,
  status: "idle",
  commands: [],
  folders: [],
  overrides: {},
  textDrafts: {},
  setTextDraft(key, texts) {
    set((state) => ({ textDrafts: { ...state.textDrafts, [key]: texts } }));
  },
  discardTextDrafts(keys) {
    set((state) => ({
      textDrafts: Object.fromEntries(
        Object.entries(state.textDrafts).filter(([key]) => !keys.includes(key)),
      ),
    }));
  },
  async load(serverId, force = false) {
    if (!force && get().serverId === serverId && get().status !== "idle") return;
    if (get().serverId !== serverId) {
      set({
        serverId,
        status: "loading",
        commands: [],
        folders: [],
        overrides: {},
        textDrafts: {},
      });
    }
    const [commands, listing] = await Promise.all([
      fetchPlayerCommands(serverId),
      listServerProjects(serverId),
    ]);
    if (get().serverId !== serverId) return;
    const folders: CommandFolder[] = listing.ok
      ? listing.projectIds.map((folder) => ({
          folder,
          ownerModule:
            listing.projects?.find((p) => (p.externalId ?? p.id) === folder)?.ownerModule ?? null,
        }))
      : [];
    const overrides: Record<string, StoredOverride> = {};
    if (commands.length > 0) {
      const reads = await Promise.all(
        [...folders]
          .sort((a, b) => a.folder.localeCompare(b.folder))
          .map(async ({ folder }) => ({
            folder,
            read: await configRead(serverId, { projectId: folder, table: OVERRIDES_DIR }),
          })),
      );
      for (const { folder, read } of reads) {
        if (!read.ok) continue;
        for (const file of [...read.files].sort((a, b) => a.path.localeCompare(b.path))) {
          const override = parseOverride(folder, file.path, file.content);
          if (override && !overrides[override.command]) overrides[override.command] = override;
        }
      }
    }
    if (get().serverId !== serverId) return;
    set({ status: "ready", commands, folders, overrides });
  },
}));
