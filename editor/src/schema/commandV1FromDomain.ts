// Domain → `command/v1` writer: the inverse of `commandV1ToDomain.ts`.
import { commandsOf } from "@/domain/documents";
import type { Command, Project } from "@/domain/types";
import { stepsToStructured } from "@/lib/actions/structuredSteps";
import { actionTextCodec } from "./fieldText";
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
  };
  if (cmd.aliases && cmd.aliases.length > 0) out.aliases = cmd.aliases;
  if (cmd.permission) out.permission = cmd.permission;
  if (cmd.description) out.description = cmd.description;
  if (cmd.arguments && cmd.arguments.length > 0) {
    out.arguments = cmd.arguments.map((arg) => ({
      ...arg.wire,
      name: arg.name,
      type: arg.wireType ?? arg.type,
      required: arg.required,
      ...(arg.default !== undefined ? { default: arg.default } : {}),
    }));
  }
  // Keys the editor does not edit, as read (requirements, fallback, cooldown…), after its own.
  return { ...out, ...cmd.wire, id: out.id };
}

/** Serialize every command in a project to canonical command/v1 objects. */
export function projectToCommandV1(project: Project): DocumentV1[] {
  return commandsOf(project).map((c) => commandV1FromDomain(c, project));
}
