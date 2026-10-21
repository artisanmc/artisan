import type { Project } from "@/domain/types";
import { configWrite } from "@/lib/api/configScreens";
import { type Texts, overridePath } from "@/lib/commandOverride";
import {
  type CommandTextField,
  type CommandTextRow,
  commandTextRows,
  withTexts,
} from "@/lib/moduleCommandTexts";
import { moduleCommandEntriesOf } from "@/lib/moduleCommands";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useMemo, useState } from "react";

export interface ModuleCommandTexts {
  /** The folder's module command texts, the edits not written yet applied. */
  rows: CommandTextRow[];
  /** Keys of the rows edited and not written yet. */
  pending: string[];
  edit: (key: string, lang: string, text: string) => void;
  save: () => Promise<boolean>;
  discard: () => void;
  saving: boolean;
  /** The server's refusal code of the last save, or `write_error`. */
  error: string | null;
}

/**
 * The texts of the module commands shown in [project]'s folder, for its Translations tab
 * (design `framework-commandes`): read from their override files, else from the module, and
 * written back to those files on the server's disk on [save] (`config/write`), apart from
 * the folder's own save.
 */
export function useModuleCommandTexts(project: Project | undefined): ModuleCommandTexts {
  const commands = useSystemCommandsStore((s) => s.commands);
  const overrides = useSystemCommandsStore((s) => s.overrides);
  const folders = useSystemCommandsStore((s) => s.folders);
  const drafts = useSystemCommandsStore((s) => s.textDrafts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = useMemo(
    () =>
      project
        ? commandTextRows(moduleCommandEntriesOf(project, { commands, overrides, folders }))
        : [],
    [project, commands, overrides, folders],
  );
  const rows = useMemo(
    () =>
      stored.map((row) => (drafts[row.key] ? { ...row, values: drafts[row.key] as Texts } : row)),
    [stored, drafts],
  );
  const pending = useMemo(
    () => stored.filter((row) => drafts[row.key]).map((row) => row.key),
    [stored, drafts],
  );

  const edit = (key: string, lang: string, text: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setError(null);
    useSystemCommandsStore.getState().setTextDraft(key, { ...row.values, [lang]: text });
  };

  const discard = () => {
    setError(null);
    useSystemCommandsStore.getState().discardTextDrafts(pending);
  };

  const save = async (): Promise<boolean> => {
    const { serverId, load, discardTextDrafts } = useSystemCommandsStore.getState();
    if (!project || !serverId || pending.length === 0) return false;
    setSaving(true);
    setError(null);
    try {
      const byCommand = new Map<
        string,
        { row: CommandTextRow; edits: Partial<Record<CommandTextField, Texts>> }
      >();
      for (const row of rows) {
        if (!pending.includes(row.key)) continue;
        const current = byCommand.get(row.entry.command.id) ?? { row, edits: {} };
        current.edits[row.field] = row.values;
        byCommand.set(row.entry.command.id, current);
      }
      // These commands show in this folder: their overrides live here, or go here.
      const files = [...byCommand.values()].map(({ row, edits }) => ({
        path: row.entry.override?.path ?? overridePath(row.entry.command.id),
        content: withTexts(row.entry, edits),
      }));
      const res = await configWrite(serverId, { projectId: project.diskId ?? project.id, files });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      // Re-read first: the rows keep the edits until the server's files hold them.
      await load(serverId, true);
      discardTextDrafts(pending);
      return true;
    } catch {
      setError("write_error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { rows, pending, edit, save, discard, saving, error };
}
