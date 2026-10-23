import type { PlayerCommand } from "@/lib/api/playerCommands";
import { parse, stringify } from "yaml";

/**
 * The admin's `command_override/v1` documents (design `framework-commandes` §3.2): one file per
 * command id in a module folder's `overrides/command/`, every absent field keeping the module's
 * value. The plugin reads them from every folder and writes one per module command that has
 * none, the module's values as comments; deleting the file resets the command.
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
  /**
   * The chain run instead of the module's code, keyed wire as in the file (a legacy DSL
   * string read as is); undefined runs the module's code.
   */
  steps?: unknown;
}

/** An override found on the server's disk. */
export interface StoredOverride {
  command: string;
  /** The module folder (project) that holds it. */
  folder: string;
  path: string;
  content: string;
  fields: OverrideFields;
  /** Requirements or a fallback: kept as written, edited in the file only. */
  hasLogic: boolean;
  /** The chain run instead of the module's code, as written; undefined when it sets none. */
  steps?: unknown;
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
  if (hasSteps(raw.steps)) fields.steps = raw.steps;
  const hasLogic =
    (Array.isArray(raw.requirements) && raw.requirements.length > 0) || raw.fallback != null;
  return {
    command,
    folder,
    path,
    content,
    fields,
    hasLogic,
    ...(raw.steps != null ? { steps: raw.steps } : {}),
  };
}

/**
 * [fields] without what equals the module's value: what the override has to hold. A
 * field the admin set back to the module's value overrides nothing, so the module's next
 * version can still change it.
 */
export function moduleChanges(command: PlayerCommand, fields: OverrideFields): OverrideFields {
  const out: OverrideFields = { enabled: fields.enabled };
  const name = fields.name?.trim().toLowerCase();
  if (name && name !== command.name) out.name = name;
  const aliases = fields.aliases?.map((alias) => alias.trim().toLowerCase()).filter(Boolean);
  if (aliases && !sameList(aliases, command.aliases)) out.aliases = aliases;
  const permission = fields.permission?.trim();
  if (permission !== undefined && permission !== (command.permission ?? "")) {
    out.permission = permission;
  }
  const description = fields.description && texts(clean(fields.description));
  if (description && !sameTexts(description, command.description)) out.description = description;
  if (fields.cooldown && fields.cooldown.duration > 0) {
    const message = fields.cooldown.message && texts(clean(fields.cooldown.message));
    out.cooldown = {
      duration: Math.round(fields.cooldown.duration),
      scope: fields.cooldown.scope,
      ...(message ? { message } : {}),
    };
  }
  if (hasSteps(fields.steps)) out.steps = fields.steps;
  return out;
}

/**
 * The file for [fields], written over [previous] so that what the form does not edit
 * (requirements, fallback, a cooldown id, unknown keys) is kept. The module's values
 * that the override leaves alone follow as comments, as in the file the server writes for
 * each module command: once nothing is left to override, that is all the file holds.
 */
export function serializeOverride(
  command: PlayerCommand,
  fields: OverrideFields,
  previous: string | null,
  root = true,
): string {
  const kept = previous ? (asMap(previous) ?? {}) : {};
  const before = kept.cooldown as Record<string, unknown> | undefined;
  const changes = moduleChanges(command, fields);
  const cooldown = changes.cooldown;
  const edited: Record<string, unknown> = {
    enabled: changes.enabled ? undefined : false,
    name: root ? changes.name : undefined,
    aliases: root ? changes.aliases : undefined,
    permission: changes.permission,
    description: changes.description ? textsToYaml(changes.description) : undefined,
    cooldown: cooldown
      ? {
          ...(typeof before?.id === "string" && before.id ? { id: before.id } : {}),
          duration_seconds: cooldown.duration,
          scope: cooldown.scope,
          ...(cooldown.message ? { message: textsToYaml(cooldown.message) } : {}),
        }
      : undefined,
    steps: changes.steps,
  };
  const raw = Object.fromEntries(
    Object.entries({ ...kept, ...edited }).filter(
      ([key, value]) => value !== undefined && key !== "schema" && key !== "command",
    ),
  );
  const head = stringify({ schema: SCHEMA, command: command.id, ...raw });
  return head + moduleValuesComment(command, root, new Set(Object.keys(raw)));
}

/** The module's values for the keys the file does not set, commented out. */
function moduleValuesComment(command: PlayerCommand, root: boolean, set: Set<string>): string {
  const values: Record<string, unknown> = {};
  if (root && !set.has("name")) values.name = command.name;
  if (root && !set.has("aliases")) values.aliases = command.aliases;
  if (command.permission != null && !set.has("permission")) values.permission = command.permission;
  if (Object.keys(command.description).length > 0 && !set.has("description")) {
    values.description = Object.fromEntries(
      Object.entries(command.description).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (Object.keys(values).length === 0) return "";
  const lines = stringify(values).trimEnd().split("\n");
  return `${MODULE_VALUES_HEADER}\n${lines.map((line) => `# ${line}`).join("\n")}\n`;
}

/** The first comment line of the file the server writes for each module command. */
const MODULE_VALUES_HEADER =
  "# The module's values. Uncomment a line to change it; delete this file to go back to them.";

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameTexts(a: Texts, b: Texts): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** A chain that replaces the module's code: an empty list or text runs the module's. */
function hasSteps(steps: unknown): boolean {
  if (Array.isArray(steps)) return steps.length > 0;
  if (typeof steps === "string") return steps.trim() !== "";
  return steps != null;
}

function clean(value: Texts): Texts {
  return Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim() !== ""));
}

/**
 * Default: the file changes nothing (the one the server writes for each module command, or
 * an override set back to the module's values). Modified: it sets a field or logic.
 */
export function overrideState(override: StoredOverride | undefined): OverrideState {
  if (!override) return "default";
  if (!override.fields.enabled) return "disabled";
  const { enabled: _, ...set } = override.fields;
  return override.hasLogic || Object.values(set).some((value) => value !== undefined)
    ? "modified"
    : "default";
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
