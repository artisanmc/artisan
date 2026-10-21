import type { PlayerCommand } from "@/lib/api/playerCommands";
import { parse, stringify } from "yaml";

/**
 * The admin's `command_override/v1` documents (design `framework-commandes` §3.2): one file per
 * command id in a module folder's `overrides/command/`, every absent field keeping the module's
 * value. The plugin reads them from every folder; deleting the file resets the command.
 */
export const OVERRIDES_DIR = "overrides/command";
const SCHEMA = "command_override/v1";

/** Texts by language; `"*"` holds a single text written as a plain string (every language). */
export type Texts = Record<string, string>;

export interface OverrideCooldown {
  /** Seconds; 0 or less removes the cooldown. */
  duration: number;
  scope: "player" | "global";
  message?: Texts;
}

/** What the System section edits; `undefined` keeps the module's value. */
export interface OverrideFields {
  enabled: boolean;
  /** Root commands only. */
  name?: string;
  /** Root commands only; `[]` removes every alias. */
  aliases?: string[];
  /** `""`: no permission at all. */
  permission?: string;
  description?: Texts;
  cooldown?: OverrideCooldown;
}

/** An override found on the server's disk. */
export interface StoredOverride {
  command: string;
  /** The module folder (project) that holds it. */
  folder: string;
  path: string;
  content: string;
  fields: OverrideFields;
  /** Requirements, fallback or steps: kept as written, edited in the file only. */
  hasLogic: boolean;
}

export type OverrideState = "default" | "modified" | "disabled";

export function overridePath(commandId: string): string {
  return `${OVERRIDES_DIR}/${commandId.replace(":", ".")}.yaml`;
}

function texts(value: unknown): Texts | undefined {
  if (typeof value === "string") return value === "" ? undefined : { "*": value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Texts = {};
  for (const [lang, text] of Object.entries(value)) if (typeof text === "string") out[lang] = text;
  return Object.keys(out).length > 0 ? out : undefined;
}

function textsToYaml(value: Texts): string | Texts {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "*" ? (value["*"] as string) : value;
}

function asMap(content: string): Record<string, unknown> | null {
  try {
    const value = parse(content);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Reads one file of `overrides/command/`; null when it is not a readable override. */
export function parseOverride(
  folder: string,
  path: string,
  content: string,
): StoredOverride | null {
  const raw = asMap(content);
  const command = typeof raw?.command === "string" ? raw.command.trim() : "";
  if (!raw || command === "") return null;
  const fields: OverrideFields = { enabled: raw.enabled !== false };
  if (typeof raw.name === "string") fields.name = raw.name;
  if (Array.isArray(raw.aliases)) fields.aliases = raw.aliases.map(String);
  if (typeof raw.permission === "string") fields.permission = raw.permission;
  const description = texts(raw.description);
  if (description) fields.description = description;
  const cooldown = raw.cooldown as Record<string, unknown> | undefined;
  const duration = Number(cooldown?.duration_seconds ?? cooldown?.duration ?? 0);
  if (cooldown && duration > 0) {
    const message = texts(cooldown.message);
    fields.cooldown = {
      duration,
      scope: cooldown.scope === "global" ? "global" : "player",
      ...(message ? { message } : {}),
    };
  }
  const hasLogic =
    (Array.isArray(raw.requirements) && raw.requirements.length > 0) ||
    raw.fallback != null ||
    raw.steps != null;
  return { command, folder, path, content, fields, hasLogic };
}

/**
 * The file for [fields], written over [previous] so that what the form does not edit
 * (requirements, fallback, steps, a cooldown id, unknown keys) is kept. Null: nothing is left
 * to override, the file goes and the command is back to the module's dressing.
 */
export function serializeOverride(
  commandId: string,
  fields: OverrideFields,
  previous: string | null,
): string | null {
  const kept = previous ? (asMap(previous) ?? {}) : {};
  const before = kept.cooldown as Record<string, unknown> | undefined;
  const description = fields.description && texts(clean(fields.description));
  const message = fields.cooldown?.message && texts(clean(fields.cooldown.message));
  const edited: Record<string, unknown> = {
    enabled: fields.enabled ? undefined : false,
    name: fields.name?.trim() ? fields.name.trim().toLowerCase() : undefined,
    aliases: fields.aliases?.map((alias) => alias.trim().toLowerCase()).filter(Boolean),
    permission: fields.permission === "" ? "" : fields.permission?.trim() || undefined,
    description: description ? textsToYaml(description) : undefined,
    cooldown:
      fields.cooldown && fields.cooldown.duration > 0
        ? {
            ...(typeof before?.id === "string" && before.id ? { id: before.id } : {}),
            duration_seconds: Math.round(fields.cooldown.duration),
            scope: fields.cooldown.scope,
            ...(message ? { message: textsToYaml(message) } : {}),
          }
        : undefined,
  };
  const raw = Object.fromEntries(
    Object.entries({ ...kept, ...edited }).filter(
      ([key, value]) => value !== undefined && key !== "schema" && key !== "command",
    ),
  );
  if (Object.keys(raw).length === 0) return null;
  return stringify({ schema: SCHEMA, command: commandId, ...raw });
}

function clean(value: Texts): Texts {
  return Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim() !== ""));
}

export function overrideState(override: StoredOverride | undefined): OverrideState {
  if (!override) return "default";
  return override.fields.enabled ? "modified" : "disabled";
}

/** The module part of a command id: the folder an override goes to when its module has none. */
export function commandNamespace(commandId: string): string {
  return commandId.slice(0, commandId.indexOf(":"));
}

/**
 * Where a new override of [command] is written: the folder that already holds one, else the
 * folder of its module, else the folder named after its namespace. Null: that folder does not
 * exist yet and is created first.
 */
export function overrideFolder(
  command: PlayerCommand,
  existing: StoredOverride | undefined,
  folders: { folder: string; ownerModule: string | null }[],
): string | null {
  if (existing) return existing.folder;
  const namespace = commandNamespace(command.id);
  const module = command.moduleId ?? namespace;
  return (
    folders.find((f) => f.ownerModule === module)?.folder ??
    folders.find((f) => f.folder === namespace)?.folder ??
    null
  );
}

/** Every command id of [commands], children included. */
export function allCommands(commands: PlayerCommand[]): PlayerCommand[] {
  return commands.flatMap((command) => [command, ...allCommands(command.children)]);
}
