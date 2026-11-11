import type { DeclaredCommand, DeclaredCommandArg } from "@/lib/api/playerCommands";
import type { CommandArg, Step } from "./types";

/** The step that runs a module command's code. */
export const MODULE_COMMAND_ACTION = "module_command";

/** The declared command of `id`, searched through the sub-commands. */
export function findDeclaredCommand(
  commands: DeclaredCommand[],
  id: string,
): DeclaredCommand | undefined {
  for (const c of commands) {
    if (c.id === id) return c;
    const child = findDeclaredCommand(c.children, id);
    if (child) return child;
  }
  return undefined;
}

/** The command a `module_command` value names: its scalar form, or its `command` argument. */
export function moduleCommandIdOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const command = (value as Record<string, unknown>).command;
    if (typeof command === "string") return command.trim() || null;
  }
  return null;
}

/** The `args` a `module_command` value maps, when it maps any. */
export function moduleCommandArgsOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const args = (value as Record<string, unknown>).args;
    if (args && typeof args === "object" && !Array.isArray(args))
      return args as Record<string, unknown>;
  }
  return {};
}

/** Every `module_command` step of a chain, the branches of an `if` included. */
export function moduleCommandSteps(steps: Step[]): { id: string; args: Record<string, unknown> }[] {
  const out: { id: string; args: Record<string, unknown> }[] = [];
  const walk = (list: Step[]) => {
    for (const step of list) {
      if (step.kind === "action") {
        if (step.action.name !== MODULE_COMMAND_ACTION) continue;
        const id = moduleCommandIdOf(step.action.value);
        if (id) out.push({ id, args: moduleCommandArgsOf(step.action.value) });
      } else {
        for (const c of step.cases) walk(c.steps);
        if (step.else) walk(step.else);
      }
    }
  };
  walk(steps);
  return out;
}

/** A declared type as the command file writes it (`ModuleCommandFiles.argument`). */
export function fileArgType(type: string): string {
  switch (type) {
    case "text":
      return "string";
    case "int":
      return "integer";
    default:
      return type;
  }
}

export type ArgDrift =
  /** Declared by the module, absent from the file: the module never receives what was typed. */
  | { kind: "missing"; name: string; type: string; required: boolean }
  /** Same name, another type than the module's. */
  | { kind: "type"; name: string; type: string; expected: string }
  /**
   * In the file, unknown to the module, while a declared one is missing: most likely that one
   * renamed. Alone, an argument of the file's own is legitimate (a text reads it).
   */
  | { kind: "extra"; name: string };

/**
 * How a command's arguments differ from those its module's code reads. A `module_command`
 * passes the typed values by name: an argument renamed, removed or retyped in the file no
 * longer reaches the module, unless the step maps it explicitly (`mapped`).
 */
export function argDrift(
  args: CommandArg[],
  declared: DeclaredCommandArg[],
  mapped: Record<string, unknown> = {},
): ArgDrift[] {
  const out: ArgDrift[] = [];
  const byName = new Map(args.map((a) => [a.name, a]));
  for (const d of declared) {
    const expected = fileArgType(d.type);
    const arg = byName.get(d.name);
    if (!arg) {
      if (!(d.name in mapped))
        out.push({ kind: "missing", name: d.name, type: expected, required: d.required });
      continue;
    }
    const type = arg.wireType ?? arg.type;
    if (type !== expected) out.push({ kind: "type", name: d.name, type, expected });
  }
  if (!out.some((d) => d.kind === "missing")) return out;
  for (const a of args) {
    if (a.name !== "" && !declared.some((d) => d.name === a.name))
      out.push({ kind: "extra", name: a.name });
  }
  return out;
}
