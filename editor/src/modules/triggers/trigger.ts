import { visitStepLTexts } from "@/domain/i18nSites";
import type { Condition, I18nKey, LText, Project, ProjectId, Step } from "@/domain/types";
import { conditionsToStructured, stepsToStructured } from "@/lib/actions/structuredSteps";
import { newI18nKey } from "@/lib/i18n";
import { makeStepConverter } from "@/schema/actionV1ToDomain";
import { actionTextCodec } from "@/schema/fieldText";

/**
 * A Trigger (`triggers/<id>.yml`, `schema: trigger/v1`, ADR `triggers-and-variables`): the
 * Game event it listens to, the conditions that filter it, a per-player cooldown, and the
 * chain it runs. `steps` are domain steps, their texts i18n sites at `triggers.<id>.do`.
 */
export interface Trigger {
  id: string;
  projectId: ProjectId;
  /** A Game event's name (`player_death`, `quests:completed`); "" before one is picked. */
  on: string;
  /** All required (the file's `if:` list). */
  conditions: Condition[];
  /** Seconds between two runs for one player; absent: none. */
  cooldownSeconds?: number;
  /** false: kept, never run. */
  enabled: boolean;
  steps: Step[];
  /** Keys the editor does not edit (`notes`…), written back as read. */
  wire?: Record<string, unknown>;
}

export const TRIGGER_KIND = {
  kind: "trigger",
  dir: "triggers",
  idPrefix: "t_",
  schemaVersion: "trigger/v1",
  rank: 3,
} as const;

/** The one chain slot of a Trigger. */
export const TRIGGER_SLOT = "do";

export const triggerKeyPrefix = (id: string): string => `triggers.${id}.do`;

const MODELLED = new Set(["schema", "id", "on", "if", "cooldown_seconds", "enabled", "do"]);

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

export interface TriggerParseResult {
  doc: Trigger;
  i18nKeys: Record<string, Record<string, string>>;
  unsupported: string[];
}

/** `trigger/v1` → Trigger, the texts of its steps minted like a command's. */
export function triggerFromFile(
  src: Json,
  opts: { projectId: string; lang: string; translations?: Record<string, Record<string, string>> },
): TriggerParseResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];
  const ref = (key: string): LText => {
    const tr = opts.translations?.[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  };
  const text = (raw: string | Record<string, string> | undefined): LText => {
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
  };
  const convert = makeStepConverter({ text, ref, pushUnsupported: (s) => unsupported.push(s) });
  const rawIf: unknown[] = Array.isArray(src.if) ? src.if : src.if ? [src.if] : [];
  const conditions = rawIf.flatMap((c) => convert.condition(c as Json) ?? []);
  const wire = Object.fromEntries(Object.entries(src).filter(([k]) => !MODELLED.has(k)));
  const cooldown = Number(src.cooldown_seconds);
  const doc: Trigger = {
    id: String(src.id ?? ""),
    projectId: opts.projectId as ProjectId,
    on: typeof src.on === "string" ? src.on.trim() : "",
    conditions,
    ...(Number.isFinite(cooldown) && cooldown > 0 ? { cooldownSeconds: Math.floor(cooldown) } : {}),
    enabled: src.enabled !== false,
    steps: src.do == null ? [] : convert.steps(src.do),
    ...(Object.keys(wire).length > 0 ? { wire } : {}),
  };
  return { doc, i18nKeys, unsupported };
}

/** Trigger → canonical `trigger/v1`, `id` included (the host strips it). */
export function triggerToFile(t: Trigger, project: Project): Record<string, unknown> {
  return {
    schema: TRIGGER_KIND.schemaVersion,
    id: t.id,
    on: t.on,
    ...(t.conditions.length > 0 ? { if: conditionsToStructured(t.conditions) } : {}),
    ...(t.cooldownSeconds ? { cooldown_seconds: t.cooldownSeconds } : {}),
    ...(t.enabled ? {} : { enabled: false }),
    ...t.wire,
    do: stepsToStructured(t.steps, actionTextCodec(project)),
  };
}

export function* triggerChainSlots(t: Trigger) {
  yield { name: TRIGGER_SLOT, steps: t.steps, prefix: triggerKeyPrefix(t.id) };
}

export function triggerLTextSites(t: Trigger) {
  return visitStepLTexts(t.steps, triggerKeyPrefix(t.id));
}
