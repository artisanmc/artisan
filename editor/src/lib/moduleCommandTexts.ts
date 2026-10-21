import { type OverrideFields, type Texts, serializeOverride } from "@/lib/commandOverride";
import type { ModuleCommandEntry } from "@/lib/moduleCommands";

/** The texts of a module command a player reads, edited in the Translations tab too. */
export type CommandTextField = "description" | "cooldown_message";

/**
 * One text of a module command, as the Translations tab lists it: [values] is what the
 * server applies (the override's texts, else the module's), [original] the module's.
 * Its key never passes for a `lang/` key: it holds `#`.
 */
export interface CommandTextRow {
  key: string;
  entry: ModuleCommandEntry;
  field: CommandTextField;
  values: Texts;
  original: Texts;
}

export const commandTextKey = (commandId: string, field: CommandTextField): string =>
  `${commandId}#${field}`;

/**
 * The texts of [entries]: each command's description, and its cooldown message once its
 * override sets a cooldown (a module declares none).
 */
export function commandTextRows(entries: ModuleCommandEntry[]): CommandTextRow[] {
  return entries.flatMap((entry) => {
    const { command, override } = entry;
    const rows: CommandTextRow[] = [
      {
        key: commandTextKey(command.id, "description"),
        entry,
        field: "description",
        values: override?.fields.description ?? command.description,
        original: command.description,
      },
    ];
    const cooldown = override?.fields.cooldown;
    if (cooldown) {
      rows.push({
        key: commandTextKey(command.id, "cooldown_message"),
        entry,
        field: "cooldown_message",
        values: cooldown.message ?? {},
        original: {},
      });
    }
    return rows;
  });
}

/** The text a player of [lang] reads, as the server picks it: their language, else every language's. */
export function textIn(values: Texts, lang: string): string {
  return values[lang] ?? values["*"] ?? "";
}

/**
 * The override file of [entry] once [edits] (whole maps by field) replace its texts;
 * everything else in the file is kept (`serializeOverride`).
 */
export function withTexts(
  entry: ModuleCommandEntry,
  edits: Partial<Record<CommandTextField, Texts>>,
): string {
  const fields: OverrideFields = { ...(entry.override?.fields ?? { enabled: true }) };
  if (edits.description) fields.description = edits.description;
  if (edits.cooldown_message && fields.cooldown) {
    fields.cooldown = { ...fields.cooldown, message: edits.cooldown_message };
  }
  return serializeOverride(entry.command, fields, entry.override?.content ?? null, entry.root);
}
