import { apiFetch } from "./client";

/** An argument of a module's command, as the module declares it. */
export interface DeclaredCommandArg {
  name: string;
  /** The module's type: `string`, `text`, `int`, `player`, `world`, `enum`. */
  type: string;
  required: boolean;
  /** The accepted words of an `enum` argument. */
  values: string[];
}

/**
 * A command a module declares (`PlayerCommandReport`), its sub-commands as `children`. Its
 * `id` is what a `module_command` step names; the arguments are the ones its code reads.
 */
export interface DeclaredCommand {
  id: string;
  moduleId: string | null;
  name: string;
  arguments: DeclaredCommandArg[];
  children: DeclaredCommand[];
}

interface WireCommand {
  id?: string;
  module_id?: string | null;
  name?: string;
  arguments?: { name?: string; type?: string; required?: boolean; values?: string[] }[];
  children?: WireCommand[];
}

function fromWire(c: WireCommand, moduleId: string | null): DeclaredCommand {
  return {
    id: c.id as string,
    moduleId: c.module_id ?? moduleId,
    name: c.name ?? "",
    arguments: (c.arguments ?? [])
      .filter((a) => typeof a.name === "string" && a.name.length > 0)
      .map((a) => ({
        name: a.name as string,
        type: a.type ?? "string",
        required: a.required === true,
        values: Array.isArray(a.values) ? a.values : [],
      })),
    children: (c.children ?? [])
      .filter((child) => typeof child.id === "string")
      .map((child) => fromWire(child, c.module_id ?? moduleId)),
  };
}

/** Commands the modules of a server declare. [] on any failure. */
export async function fetchServerPlayerCommands(serverId: string): Promise<DeclaredCommand[]> {
  try {
    const data = await apiFetch<{ player_commands?: WireCommand[] }>(
      `/api/v1/servers/${serverId}/player-commands`,
    );
    return (data.player_commands ?? [])
      .filter((c) => typeof c.id === "string" && c.id.length > 0)
      .map((c) => fromWire(c, null));
  } catch {
    return [];
  }
}
