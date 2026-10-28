import type {
  CommandArg,
  CommandId,
  CommandNode,
  Command as DomainCommand,
  I18nKey,
  LText,
  ProjectId,
} from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";
import { makeStepConverter } from "./actionV1ToDomain";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

export interface CommandImportResult {
  command: DomainCommand;
  /** i18n keys allocated for literal text (to merge into project.i18nKeys by the caller). */
  i18nKeys: Record<string, Record<string, string>>;
  /** command/v1 constructs without a domain equivalent. */
  unsupported: string[];
}

const ARG_TYPES = new Set(["player", "string", "integer", "number", "boolean"]);

/** The keys the domain models on every node; every other key is kept in its `wire`. */
const NODE_KEYS = [
  "name",
  "aliases",
  "permission",
  "description",
  "enabled",
  "arguments",
  "actions",
  "subcommands",
];
const COMMAND_KEYS = new Set([...NODE_KEYS, "schema", "id", "steps"]);
const SUBCOMMAND_KEYS = new Set(NODE_KEYS);
const ARG_KEYS = new Set(["name", "type", "required", "default"]);

function rest(src: Json, modelled: Set<string>): Json | undefined {
  const out = Object.fromEntries(Object.entries(src).filter(([key]) => !modelled.has(key)));
  return Object.keys(out).length > 0 ? out : undefined;
}

export function commandV1ToDomain(
  src: Json,
  opts: {
    projectId: ProjectId;
    lang: string;
    translations?: Record<string, Record<string, string>>;
  },
): CommandImportResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];

  function ref(key: string): LText {
    const tr = opts.translations?.[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  }
  function text(raw: string | Record<string, string> | undefined): LText {
    if (raw && typeof raw === "object") {
      const key = newI18nKey();
      i18nKeys[key] = { ...raw };
      return { key };
    }
    const m = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
    if (m) return ref(m[1]!);
    const key = newI18nKey();
    i18nKeys[key] = { [opts.lang]: raw ?? "" };
    return { key };
  }

  const { steps: parseSteps } = makeStepConverter({
    text,
    ref,
    pushUnsupported: (s) => unsupported.push(s),
  });

  function readArgs(raw: unknown): CommandArg[] {
    return ((raw as Json[]) ?? []).map((a) => {
      const type = String(a.type ?? "string");
      const known = type === "online_player" ? "player" : type === "int" ? "integer" : type;
      const wire = rest(a, ARG_KEYS);
      return {
        name: a.name,
        // A type without a control here reads as a string and goes back as written.
        type: (ARG_TYPES.has(known) ? known : "string") as CommandArg["type"],
        ...(ARG_TYPES.has(known) ? {} : { wireType: type }),
        required: a.required ?? true,
        ...(a.default !== undefined ? { default: String(a.default) } : {}),
        ...(wire ? { wire } : {}),
      };
    });
  }

  /** The fields every node shares. `steps` is the root's legacy spelling of `actions`. */
  function readNode(node: Json, modelled: Set<string>): Omit<CommandNode, "name"> {
    // What the editor does not edit yet (requirements, fallback, cooldown…) rides along untouched.
    const wire = rest(node, modelled);
    const subcommands = Array.isArray(node.subcommands)
      ? (node.subcommands as Json[]).map(
          (sub): CommandNode => ({
            name: String(sub.name ?? ""),
            ...readNode(sub, SUBCOMMAND_KEYS),
          }),
        )
      : undefined;
    return {
      arguments: readArgs(node.arguments),
      steps: parseSteps(modelled === COMMAND_KEYS ? (node.actions ?? node.steps) : node.actions),
      ...(Array.isArray(node.aliases) && node.aliases.length > 0 ? { aliases: node.aliases } : {}),
      ...(node.permission ? { permission: node.permission } : {}),
      // A string is every language's text; `{lang: text}` its translations.
      ...(node.description ? { description: text(node.description) } : {}),
      ...(node.enabled === false ? { enabled: false } : {}),
      ...(subcommands ? { subcommands } : {}),
      ...(wire ? { wire } : {}),
    };
  }

  const command: DomainCommand = {
    id: src.id as CommandId,
    projectId: opts.projectId,
    name: src.name ?? src.id,
    ...readNode(src, COMMAND_KEYS),
  };

  return { command, i18nKeys, unsupported };
}
