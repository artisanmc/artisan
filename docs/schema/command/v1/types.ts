/**
 * Artisan — Command schema v1 — TypeScript types
 *
 * Source of truth for a command's intermediate format.
 * Maintained by hand, mirroring schema.json. The two MUST stay in sync.
 *
 * Actions, Conditions and Steps are reused from menu/v1 — a command
 * shares the same effect catalog as a menu click handler.
 *
 * Vocabulary:
 *   - "Command"   : first-class entity in the workspace (same level as a Menu).
 *                   Runs actions, can accept typed arguments.
 *   - "Argument"  : typed positional parameter. Its resolved value is exposed as the
 *                   placeholder %args_<name>% to the opened menu (if any) and
 *                   usable in the command's own actions/requirements.
 *   - "Context"   : set of resolved args, attached to a menu when it is opened
 *                   from a command. Propagated by default to chained open_menu
 *                   (unless clear_context: true).
 */

import type { ClickHandler, Condition, StructuredStep } from "../../menu/v1/types";

// ============================================================================
// TOP-LEVEL
// ============================================================================

export interface Command {
  schema: "command/v1";
  id: string;
  name: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  /** Internal admin notes (never shown to players). Round-trip-safe JSON ↔ YAML. */
  notes?: string;
  arguments?: Argument[];
  requirements?: Condition[];
  /** Action chain run when the command is called (ADR `structured-action-wire`). */
  actions?: ClickHandler;
  /** Legacy form of `actions` — still accepted when reading. */
  steps?: ClickHandler;
  /** Run if requirements fail. */
  fallback?: StructuredStep[];
  cooldown?: Cooldown;
  metadata?: CommandMetadata;
}

/** Cooldown between runs. Scope is player (default) or server. */
export interface Cooldown {
  /** Cooldown identifier, shared between runs of the same scope. */
  id: string;
  /** Cooldown duration in seconds (> 0). */
  duration_seconds: number;
  /** player = per player; server = server-wide. Default: "player". */
  scope?: "player" | "server";
  /** Message shown while the cooldown is active. i18n reference {i18n:key} or MiniMessage literal. */
  message?: string;
}

export interface CommandMetadata {
  uses_plugins?: string[];
  created_at?: string;
  updated_at?: string;
  author?: string;
  [key: string]: unknown;
}

// ============================================================================
// ARGUMENTS
// ============================================================================

export type ArgumentType =
  | "player"          // online or offline, resolved via UUID
  | "online_player"   // must be connected
  | "string"
  | "integer"
  | "number"          // float
  | "boolean"
  | "world"
  | "enum";           // values set by the admin

export interface Argument {
  name: string;
  type: ArgumentType;
  /** Default true. Optional ones must follow the required ones. */
  required?: boolean;
  /** Default value if omitted. May contain placeholders ("%player_name%"). */
  default?: unknown;
  /** Allowed values for type === "enum". Required if enum. */
  values?: string[];
  description?: string;
}

export const ARGUMENT_TYPES = [
  "player", "online_player",
  "string", "integer", "number", "boolean",
  "world", "enum",
] as const satisfies ReadonlyArray<ArgumentType>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export interface CommandCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Checks the command's consistency beyond the JSON Schema:
 *   - unique argument names
 *   - required arguments precede optional ones
 *   - enum has a non-empty values
 *   - aliases do not contain the main name
 *   - default only on non-required arguments (ignored otherwise)
 */
export function validateCommand(cmd: Command): CommandCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (cmd.aliases?.includes(cmd.name)) {
    errors.push(`Alias "${cmd.name}" is identical to the main name.`);
  }

  if (cmd.arguments) {
    const seen = new Set<string>();
    let optionalEncountered = false;
    for (const arg of cmd.arguments) {
      if (seen.has(arg.name)) {
        errors.push(`Argument "${arg.name}" is duplicated.`);
      }
      seen.add(arg.name);

      const isRequired = arg.required !== false;
      if (!isRequired) optionalEncountered = true;
      if (isRequired && optionalEncountered) {
        errors.push(`Required argument "${arg.name}" follows an optional one — invalid order.`);
      }

      if (arg.type === "enum" && (!arg.values || arg.values.length === 0)) {
        errors.push(`Enum argument "${arg.name}" must have a non-empty values field.`);
      }

      if (isRequired && arg.default !== undefined) {
        warnings.push(`Argument "${arg.name}" has a default but is required — default will be ignored.`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Lists the %args_*% placeholders a command will inject into the menus
 * it opens. Useful for the editor (auto-completion, cross-reference validation).
 */
export function placeholdersFromCommand(cmd: Command): string[] {
  if (!cmd.arguments) return [];
  const out: string[] = [];
  for (const arg of cmd.arguments) {
    out.push(`%args_${arg.name}%`);
    if (arg.type === "player" || arg.type === "online_player") {
      out.push(`%args_${arg.name}_uuid%`);
      out.push(`%args_${arg.name}_displayname%`);
    }
  }
  return out;
}
