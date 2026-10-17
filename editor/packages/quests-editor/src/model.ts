import type {
  DocumentParseContext,
  DocumentParseResult,
  LTextSiteContribution,
} from "@artisan/editor-sdk";
import { fieldText, newTextKey } from "@artisan/editor-sdk";

/**
 * A `quest_group/v1` Document in the editor (ArtisanQuests design §3): the file with its
 * text sites turned into text nodes (`{key}`, the host's `LText`), the fields the views
 * edit typed, and everything else kept verbatim in `rest` maps so a round trip loses
 * nothing the editor does not know yet (`on`, `window`, `requirements`, a new field).
 *
 * The server's reader (`QuestGroupDocumentReader` in ArtisanQuests) is the reference:
 * what it refuses, the editor never writes.
 */

export const KIND = "quest_group";
export const DIR = "quest_groups";
export const SCHEMA = "quest_group/v1";

export type Raw = Record<string, unknown>;
export interface Text {
  key: string;
}

export interface Objective {
  key: string;
  type: string;
  /** The type's own fields (`material`, `amount`…), verbatim. */
  params: Raw;
}

export type Flow = "" | "parallel" | "sequential";

export interface Stage {
  key: string;
  title: Text;
  flow: Flow;
  objectives: Objective[];
  rest: Raw;
}

export interface Quest {
  key: string;
  uid: string;
  tier: string;
  title: Text;
  description: Text;
  /** `24h`, `1h30m`, `90s` or seconds; "" = no limit. */
  duration: string;
  stages: Stage[];
  /** `rewards` (a list of actions), `requirements`, `reward_display`… verbatim. */
  rest: Raw;
}

export interface Tier {
  key: string;
  title: Text;
  rest: Raw;
}

export interface QuestGroup {
  id: string;
  projectId: string;
  uid: string;
  title: Text;
  description: Text;
  actorType: string;
  /** `cron`, `timezone`. */
  reset: Raw;
  /** `max_active`, `max_per_period`. */
  limits: Raw;
  /** `enabled`, `max_per_period`. */
  rotation: Raw;
  /** `strategy`, `amount`, `triggers`, `tiers`. */
  distribution: Raw;
  tiers: Tier[];
  quests: Quest[];
  rest: Raw;
}

// ------------------------------------------------------------------ ids

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID (time-ordered, 26 chars), what the server generates for `uid`. */
export function newUid(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let random = "";
  for (let i = 0; i < 16; i++) random += CROCKFORD[bytes[i]! % 32];
  return time + random;
}

/** `base`, else `base_2`, `base_3`… : the first not in `taken`. */
export function freeKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A key as it is typed: lowercase, anything outside `[a-z0-9_]` becomes `_`. */
export function typedKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/** A key typed by hand, made safe: lowercase, `[a-z0-9_]`, not empty. */
export function slugKey(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "quest"
  );
}

// ------------------------------------------------------------------ parse

function asMap(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Raw) } : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function without(map: Raw, ...keys: string[]): Raw {
  const out = { ...map };
  for (const k of keys) delete out[k];
  return out;
}

export function parseQuestGroup(src: Raw, ctx: DocumentParseContext): DocumentParseResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];

  // Same three shapes as every Artisan text site (ADR `field-local-translations`).
  function text(raw: unknown): Text {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const key = newTextKey();
      const langs: Record<string, string> = {};
      for (const [lang, v] of Object.entries(raw as Raw)) langs[lang] = asString(v);
      i18nKeys[key] = langs;
      return { key };
    }
    const ref = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
    if (ref) {
      const tr = ctx.translations?.[ref[1]!];
      if (tr) i18nKeys[ref[1]!] = { ...tr };
      return { key: ref[1]! };
    }
    const key = newTextKey();
    i18nKeys[key] = raw == null || raw === "" ? {} : { [ctx.lang]: asString(raw) };
    return { key };
  }

  const tiers = Object.entries(asMap(src.tiers)).map(([key, value]) => {
    const tier = asMap(value);
    return { key, title: text(tier.title), rest: without(tier, "title") };
  });

  const quests = asList(src.quests).map((item, qi): Quest => {
    const q = asMap(item);
    const stages = asList(q.stages).map((stageItem, si): Stage => {
      const s = asMap(stageItem);
      const flow = asString(s.flow).toLowerCase();
      return {
        key: asString(s.key) || `stage_${si + 1}`,
        title: text(s.title),
        flow: flow === "parallel" || flow === "sequential" ? flow : "",
        objectives: asList(s.objectives).map((o, oi) => {
          const obj = asMap(o);
          return {
            key: asString(obj.key) || `objective_${oi + 1}`,
            type: asString(obj.type),
            params: without(obj, "key", "type"),
          };
        }),
        rest: without(s, "key", "title", "flow", "objectives"),
      };
    });
    return {
      key: asString(q.key) || `quest_${qi + 1}`,
      uid: asString(q.uid) || newUid(),
      tier: asString(q.tier),
      title: text(q.title),
      description: text(q.description),
      duration: asString(q.duration),
      stages,
      rest: without(q, "key", "uid", "tier", "title", "description", "duration", "stages"),
    };
  });

  const doc: QuestGroup = {
    id: asString(src.id),
    projectId: ctx.projectId,
    uid: asString(src.uid) || newUid(),
    title: text(src.title),
    description: text(src.description),
    actorType: asString(src.actor_type) || "player",
    reset: asMap(src.reset),
    limits: asMap(src.limits),
    rotation: asMap(src.rotation),
    distribution: asMap(src.distribution),
    tiers,
    quests,
    rest: without(
      asMap(src),
      "id",
      "schema",
      "uid",
      "title",
      "description",
      "actor_type",
      "reset",
      "limits",
      "rotation",
      "distribution",
      "tiers",
      "quests",
    ),
  };
  if (src.schema !== undefined && src.schema !== SCHEMA)
    unsupported.push(`schema: ${String(src.schema)}`);
  return { doc, i18nKeys, unsupported };
}

// ------------------------------------------------------------------ serialize

function isEmptyText(value: string | Record<string, string>): boolean {
  return typeof value === "string" ? value === "" : Object.values(value).every((v) => v === "");
}

/** Drops the keys holding nothing (null, "", {}, []), so a cleared field leaves the file. */
function compact(map: Raw): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(map)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as Raw).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** The order of a file's top-level keys; the ones the editor does not know follow. */
const ORDER = [
  "id",
  "schema",
  "uid",
  "title",
  "description",
  "actor_type",
  "window",
  "reset",
  "limits",
  "rotation",
  "distribution",
  "tiers",
  "on",
  "quests",
];

export function serializeQuestGroup(group: QuestGroup, project: unknown): Raw {
  const t = (node: Text) => fieldText(project, node.key);
  const optional = (node: Text) => {
    const value = t(node);
    return isEmptyText(value) ? undefined : value;
  };

  const tiers: Raw = {};
  for (const tier of group.tiers) tiers[tier.key] = { ...tier.rest, title: t(tier.title) };

  const quests = group.quests.map((q) =>
    compact({
      key: q.key,
      uid: q.uid,
      tier: q.tier,
      title: t(q.title),
      description: optional(q.description),
      duration: q.duration,
      ...q.rest,
      stages: q.stages.map((s) =>
        compact({
          key: s.key,
          title: optional(s.title),
          flow: s.flow,
          ...s.rest,
          objectives: s.objectives.map((o) => ({ key: o.key, type: o.type, ...o.params })),
        }),
      ),
    }),
  );

  const fields: Raw = {
    ...group.rest,
    id: group.id,
    schema: SCHEMA,
    uid: group.uid,
    title: t(group.title),
    description: optional(group.description),
    actor_type: group.actorType,
    reset: compact(group.reset),
    limits: compact(group.limits),
    rotation: compact(group.rotation),
    distribution: compact(group.distribution),
    tiers,
    quests,
  };
  const out: Raw = {};
  for (const key of ORDER) if (key in fields) out[key] = fields[key];
  for (const key of Object.keys(fields)) if (!(key in out)) out[key] = fields[key];
  // `quests: []` stays: an empty group is still a group.
  const kept = compact(out);
  kept.quests = quests;
  return kept;
}

// ------------------------------------------------------------------ text sites

/**
 * Each text node and its canonical key. Quests are addressed by `uid` (unique and
 * immutable), stages by key within their quest: a reorder never moves a text.
 */
export function* questGroupTextSites(group: QuestGroup): Iterable<LTextSiteContribution> {
  const base = `${DIR}.${group.id}`;
  yield { lText: group.title, key: `${base}.title`, path: "title", kind: "quest_group.title" };
  yield {
    lText: group.description,
    key: `${base}.description`,
    path: "description",
    kind: "quest_group.description",
  };
  for (const tier of group.tiers) {
    yield {
      lText: tier.title,
      key: `${base}.tiers.${tier.key}.title`,
      path: `tiers.${tier.key}.title`,
      kind: "quest_group.tier",
    };
  }
  const seen = new Set<string>();
  for (let qi = 0; qi < group.quests.length; qi++) {
    const q = group.quests[qi]!;
    const qid = seen.has(q.uid) ? `${q.uid}_${qi}` : q.uid;
    seen.add(q.uid);
    const qbase = `${base}.quests.${qid}`;
    yield {
      lText: q.title,
      key: `${qbase}.title`,
      path: `quests[${qi}].title`,
      kind: "quest.title",
    };
    yield {
      lText: q.description,
      key: `${qbase}.description`,
      path: `quests[${qi}].description`,
      kind: "quest.description",
    };
    const stageKeys = new Set<string>();
    for (let si = 0; si < q.stages.length; si++) {
      const s = q.stages[si]!;
      const sid = stageKeys.has(s.key) ? `${s.key}_${si}` : s.key;
      stageKeys.add(s.key);
      yield {
        lText: s.title,
        key: `${qbase}.stages.${sid}.title`,
        path: `quests[${qi}].stages[${si}].title`,
        kind: "quest.stage",
      };
    }
  }
}
