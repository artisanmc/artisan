import { commandKeyPrefix } from "@/lib/i18nKeys";
import type { Command, CommandNode, CommandNodePath } from "./types";

/** The node at `path` under `command` (the command itself for an empty or absent path). */
export function commandNodeAt(
  command: CommandNode,
  path: CommandNodePath | undefined,
): CommandNode | undefined {
  let node: CommandNode | undefined = command;
  for (const index of path ?? []) node = node?.subcommands?.[index];
  return node;
}

/**
 * Key prefix of a node's texts: `commands.<id>` for the root, `….subcommands.<i>` per
 * level. By index, not name: two siblings typed with the same name keep their own texts.
 */
export function commandNodeKeyPrefix(commandId: string, path: CommandNodePath): string {
  return path.reduce<string>(
    (prefix, i) => `${prefix}.subcommands.${i}`,
    commandKeyPrefix(commandId),
  );
}

export interface CommandNodeVisit {
  node: CommandNode;
  path: number[];
  /** The words typed to reach it, the root's name first: `["ah", "sell"]`. */
  words: string[];
  prefix: string;
}

/** The command, then each sub-command depth-first, in file order. */
export function* walkCommandNodes(command: Command): Generator<CommandNodeVisit> {
  function* walk(node: CommandNode, path: number[], words: string[]): Generator<CommandNodeVisit> {
    yield { node, path, words, prefix: commandNodeKeyPrefix(command.id, path) };
    const children = node.subcommands ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      yield* walk(child, [...path, i], [...words, child.name]);
    }
  }
  yield* walk(command, [], [command.name]);
}

/** Every step list of the command and its sub-commands. */
export function commandStepLists(command: Command): CommandNode["steps"][] {
  return [...walkCommandNodes(command)].map((v) => v.node.steps);
}
