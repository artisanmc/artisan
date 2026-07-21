/**
 * Artisan — Command schema v1 — TypeScript types
 *
 * Source de vérité pour le format intermédiaire d'une commande.
 * Maintenu à la main, en miroir de schema.json. Les deux DOIVENT rester synchrones.
 *
 * Les Actions, Conditions et Steps sont réutilisés depuis menu/v1 — une commande
 * partage le même catalogue d'effets qu'un click handler de menu.
 *
 * Vocabulaire :
 *   - "Command"   : entité de premier ordre dans le workspace (au même niveau qu'un Menu).
 *                   Exécute des actions, peut accepter des arguments typés.
 *   - "Argument"  : paramètre positionnel typé. Sa valeur résolue est exposée comme
 *                   placeholder %args_<name>% au menu ouvert (le cas échéant) et
 *                   utilisable dans les actions/requirements de la commande elle-même.
 *   - "Contexte"  : ensemble des args résolus, attaché à un menu quand il est ouvert
 *                   depuis une commande. Propagé par défaut aux open_menu chaînés
 *                   (sauf clear_context: true).
 */

import type { Action, Condition, Step } from "../../menu/v1/types";

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
  /** Notes internes de l'admin (jamais rendues aux joueurs). Round-trip-safe JSON ↔ YAML. */
  notes?: string;
  arguments?: Argument[];
  requirements?: Condition[];
  /** Chaîne **Action DSL** exécutée quand la commande est appelée (actions + branches if). Cf. ADR `action-dsl`. */
  steps: string;
  /** Exécuté si requirements échoue. */
  fallback?: Action[];
  cooldown?: Cooldown;
  metadata?: CommandMetadata;
}

/** Cooldown entre exécutions. Scope player (par défaut) ou server. */
export interface Cooldown {
  /** Identifiant du cooldown, partagé entre exécutions du même scope. */
  id: string;
  /** Durée du cooldown en secondes (> 0). */
  duration_seconds: number;
  /** player = par joueur ; server = global au serveur. Default: "player". */
  scope?: "player" | "server";
  /** Message affiché quand le cooldown est actif. Référence i18n {i18n:key} ou littéral MiniMessage. */
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
  | "player"          // online ou offline, résolu via UUID
  | "online_player"   // doit être connecté
  | "string"
  | "integer"
  | "number"          // float
  | "boolean"
  | "world"
  | "enum";           // valeurs fixées par l'admin

export interface Argument {
  name: string;
  type: ArgumentType;
  /** Default true. Les optionnels doivent suivre les required. */
  required?: boolean;
  /** Valeur par défaut si omis. Peut contenir des placeholders ("%player_name%"). */
  default?: unknown;
  /** Valeurs autorisées pour type === "enum". Requis si enum. */
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
 * Vérifie cohérence de la commande au-delà du JSON Schema :
 *   - noms d'arguments uniques
 *   - required précèdent les optionnels
 *   - enum a un values non vide
 *   - aliases ne contiennent pas le name principal
 *   - default uniquement sur les arguments non-required (ignoré sinon)
 */
export function validateCommand(cmd: Command): CommandCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (cmd.aliases?.includes(cmd.name)) {
    errors.push(`L'alias "${cmd.name}" est identique au name principal.`);
  }

  if (cmd.arguments) {
    const seen = new Set<string>();
    let optionalEncountered = false;
    for (const arg of cmd.arguments) {
      if (seen.has(arg.name)) {
        errors.push(`Argument "${arg.name}" est dupliqué.`);
      }
      seen.add(arg.name);

      const isRequired = arg.required !== false;
      if (!isRequired) optionalEncountered = true;
      if (isRequired && optionalEncountered) {
        errors.push(`Argument required "${arg.name}" suit un optionnel — ordre invalide.`);
      }

      if (arg.type === "enum" && (!arg.values || arg.values.length === 0)) {
        errors.push(`Argument enum "${arg.name}" doit avoir un champ values non vide.`);
      }

      if (isRequired && arg.default !== undefined) {
        warnings.push(`Argument "${arg.name}" a un default mais est required — default sera ignoré.`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Liste les placeholders %args_*% qu'une commande va injecter dans les menus
 * qu'elle ouvre. Utile pour l'éditeur (auto-completion, validation cross-référence).
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
