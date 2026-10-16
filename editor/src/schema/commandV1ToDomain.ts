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
    let type = a.type as string;
    if (type === "online_player") type = "player";
    else if (!ARG_TYPES.has(type)) {
      unsupported.push(`arg type: ${type}`);
      type = "string";
    }
    return {
      name: a.name,
      type: type as CommandArg["type"],
      required: a.required ?? true,
      ...(a.default !== undefined ? { default: String(a.default) } : {}),
    };
  });

  for (const field of ["requirements", "fallback", "cooldown"]) {
    if (src[field] !== undefined) unsupported.push(`command.${field}`);
  }

  const command: DomainCommand = {
    id: src.id as CommandId,
    projectId: opts.projectId,
    name: src.name ?? src.id,
    arguments: args,
    steps,
    ...(Array.isArray(src.aliases) && src.aliases.length > 0 ? { aliases: src.aliases } : {}),
    ...(src.permission ? { permission: src.permission } : {}),
    ...(src.description ? { description: src.description } : {}),
  };

  return { command, i18nKeys, unsupported };
}
