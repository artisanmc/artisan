import { apiFetch } from "./client";

/** A positional argument of a module command, as the server declares it. */
export interface PlayerCommandArgument {
  name: string;
  type: string;
  required: boolean;
  values: string[];
}

/**
 * A player command a module declares (`player_commands` of the Presence, `PlayerCommandReport`):
 * its default dressing, which the admin's `command_override/v1` changes field by field.
 */
export interface PlayerCommand {
  /** `<module>:<name>`, never changed: what an override targets. */
  id: string;
  /** The module that registered it; null when its plugin registered it outside a module. */
  moduleId: string | null;
  name: string;
  aliases: string[];
  /** Null: everyone may run it. */
  permission: string | null;
  /** By language code; may be empty. */
  description: Record<string, string>;
  arguments: PlayerCommandArgument[];
  consoleAllowed: boolean;
  children: PlayerCommand[];
}

type Wire = {
  id?: string;
  module_id?: string | null;
  name?: string;
  aliases?: string[];
  permission?: string | null;
  description?: Record<string, string>;
  arguments?: PlayerCommandArgument[];
  console_allowed?: boolean;
  children?: Wire[];
};

function fromWire(wire: Wire): PlayerCommand | null {
  if (!wire.id || !wire.name) return null;
  return {
    id: wire.id,
    moduleId: wire.module_id ?? null,
    name: wire.name,
    aliases: wire.aliases ?? [],
    permission: wire.permission ?? null,
    description: wire.description ?? {},
    arguments: wire.arguments ?? [],
    consoleAllowed: wire.console_allowed === true,
    children: (wire.children ?? []).flatMap((child) => fromWire(child) ?? []),
  };
}

/** The commands the server's modules declare. [] on any failure, or from a server that does not announce them. */
export async function fetchPlayerCommands(serverId: string): Promise<PlayerCommand[]> {
  try {
    const body = await apiFetch<{ player_commands?: Wire[] }>(
      `/api/v1/servers/${serverId}/player-commands`,
    );
    return (body.player_commands ?? []).flatMap((wire) => fromWire(wire) ?? []);
  } catch {
    return [];
  }
}
