import type {
  CommandArg,
  CommandId,
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

/** The keys the domain models; every other key of the file is kept in `wire`. */
const COMMAND_KEYS = new Set([
  "schema",
  "id",
  "name",
  "aliases",
  "permission",
  "description",
  "arguments",
  "actions",
  "steps",
]);
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

  // command/v1 action chain is an Action DSL string (ADR action-dsl).
  // Canonical field is `actions`; `steps` is the legacy spelling still accepted.
  const steps = parseSteps(src.actions ?? src.steps);

  const args: CommandArg[] = ((src.arguments as Json[]) ?? []).map((a) => {
    const raw = String(a.type ?? "string");
    const known = raw === "online_player" ? "player" : raw === "int" ? "integer" : raw;
    const wire = rest(a, ARG_KEYS);
    return {
      name: a.name,
      // A type without a control here reads as a string and goes back as written.
      type: (ARG_TYPES.has(known) ? known : "string") as CommandArg["type"],
      ...(ARG_TYPES.has(known) ? {} : { wireType: raw }),
      required: a.required ?? true,
      ...(a.default !== undefined ? { default: String(a.default) } : {}),
      ...(wire ? { wire } : {}),
    };
  });

  // What the editor does not edit yet (requirements, fallback, cooldown…) rides along untouched.
  const wire = rest(src, COMMAND_KEYS);

  const command: DomainCommand = {
    id: src.id as CommandId,
    projectId: opts.projectId,
    name: src.name ?? src.id,
    arguments: args,
    steps,
    ...(Array.isArray(src.aliases) && src.aliases.length > 0 ? { aliases: src.aliases } : {}),
    ...(src.permission ? { permission: src.permission } : {}),
    ...(src.description ? { description: src.description } : {}),
    ...(wire ? { wire } : {}),
  };

  return { command, i18nKeys, unsupported };
}
