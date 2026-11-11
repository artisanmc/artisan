import type { Command, CommandNode } from "@/domain/types";

/** A typed command line matched against the Project's commands. */
export type CommandMatch =
  | {
      kind: "match";
      command: Command;
      /** The node that runs: the command, or the deepest sub-command typed. */
      node: CommandNode;
      /** The names typed down to `node` (`["ah", "sell"]`). */
      path: string[];
      /** Argument values by name; a missing optional one is left out. */
      args: Record<string, string>;
    }
  | { kind: "missing"; node: CommandNode; path: string[]; arg: string }
  | { kind: "unknown"; label: string };

const named = (node: CommandNode, token: string) => {
  const t = token.toLowerCase();
  return node.name.toLowerCase() === t || (node.aliases ?? []).some((a) => a.toLowerCase() === t);
};

/**
 * `/ah sell 100` → the command `ah`, its sub-command `sell`, `{amount: "100"}`. Sub-commands
 * are matched by name or alias before the arguments; the last argument takes the rest of
 * the line when it is a string (a message). A `player` argument whose default is
 * `{sender}` binds the player typing. A disabled command or sub-command does not exist.
 */
export function matchCommand(
  line: string,
  commands: readonly Command[],
  sender: string,
): CommandMatch {
  const tokens = line.trim().replace(/^\//, "").split(/\s+/).filter(Boolean);
  const label = tokens[0] ?? "";
  const command = commands.find((c) => c.enabled !== false && named(c, label));
  if (!command) return { kind: "unknown", label };
  let node: CommandNode = command;
  const path = [command.name];
  let i = 1;
  while (i < tokens.length) {
    const sub: CommandNode | undefined = (node.subcommands ?? []).find(
      (s) => s.enabled !== false && named(s, tokens[i]!),
    );
    if (!sub) break;
    node = sub;
    path.push(sub.name);
    i++;
  }
  const args: Record<string, string> = {};
  const rest = tokens.slice(i);
  for (let k = 0; k < node.arguments.length; k++) {
    const arg = node.arguments[k]!;
    const last = k === node.arguments.length - 1;
    const value = last && arg.type === "string" ? rest.slice(k).join(" ") : rest[k];
    if (value !== undefined && value !== "") args[arg.name] = value;
    else if (arg.type === "player" && arg.default === "{sender}") args[arg.name] = sender;
    else if (arg.default !== undefined && arg.default !== "") args[arg.name] = arg.default;
    else if (arg.required) return { kind: "missing", node, path, arg: arg.name };
  }
  return { kind: "match", command, node, path, args };
}
