// Domain → `command/v1` writer: the inverse of `commandV1ToDomain.ts`.
import { commandsOf } from "@/domain/documents";
import type { Command, CommandNode, Project } from "@/domain/types";
import { stepsToStructured } from "@/lib/actions/structuredSteps";
import { actionTextCodec, fieldTextOf } from "./fieldText";
import type { DocumentV1 } from "./menuV1FromDomain";

export function commandV1FromDomain(cmd: Command, project: Project): DocumentV1 {
  const out: DocumentV1 = {
    schema: "command/v1",
    id: cmd.id,
    // `name` (the in-game trigger) is only written when it differs from `id`.
    ...(cmd.name !== cmd.id ? { name: cmd.name } : {}),
    // The command's action chain serializes to structured steps (ADR
    // `structured-action-wire`). Canonical field: `actions`.
    actions: stepsToStructured(cmd.steps, actionTextCodec(project)),
    ...nodeFields(cmd, project),
  };
  // Keys the editor does not edit, as read (requirements, fallback, cooldown…), after its own.
  return { ...out, ...cmd.wire, id: out.id };
}

/** A sub-command: `actions` only when it has steps, a node without them listing its children. */
function subcommandV1(node: CommandNode, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = { name: node.name };
  const fields = nodeFields(node, project);
  if (node.steps.length > 0) out.actions = stepsToStructured(node.steps, actionTextCodec(project));
  return { ...out, ...fields, ...node.wire };
}

/** What a command and a sub-command write alike, in file order. */
function nodeFields(node: CommandNode, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.aliases && node.aliases.length > 0) out.aliases = node.aliases;
  if (node.permission) out.permission = node.permission;
  if (node.description) {
    const text = fieldTextOf(project)(node.description.key);
    if (typeof text !== "string" || text !== "") out.description = text;
  }
  if (node.enabled === false) out.enabled = false;
  if (node.arguments.length > 0) {
    out.arguments = node.arguments.map((arg) => ({
      ...arg.wire,
      name: arg.name,
      type: arg.wireType ?? arg.type,
      required: arg.required,
      ...(arg.default !== undefined ? { default: arg.default } : {}),
    }));
  }
  if (node.subcommands && node.subcommands.length > 0)
    out.subcommands = node.subcommands.map((sub) => subcommandV1(sub, project));
  return out;
}

/** Serialize every command in a project to canonical command/v1 objects. */
export function projectToCommandV1(project: Project): DocumentV1[] {
  return commandsOf(project).map((c) => commandV1FromDomain(c, project));
}
