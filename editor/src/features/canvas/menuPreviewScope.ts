import type { I18nKey, Menu, Project, SourceRef } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { AstCache } from "@/lib/expr/cache";
import { Scope } from "@/lib/expr/scope";
import { renderTemplate } from "@/lib/expr/template/renderer";
import { listModules } from "@artisan/editor-sdk";
import { useAccountStore } from "@/state/accountStore";

/** Cached live-server snapshots keyed by ref (see serverSnapshotsStore). */
export type SourceSnapshots = Record<string, unknown[]>;

/**
 * Authoring-time rows a registered frontend module computes from a project's
 * moduleData (FrontendModule.localPreviewRows) — e.g. the boutique form's
 * items, so tiles/canvas update live while editing, before any deploy.
 *
 * Module data may live in a **sibling project** (the plugin merges module
 * files across ALL projects of the server at runtime — cf. BoutiqueModule
 * .reloadRepo), so after the current project we probe the account's other
 * projects. Null when no module owns the ref or no project holds local data.
 */
export function moduleLocalRows(
  project: Project,
  ref: SourceRef | string,
): Record<string, unknown>[] | null {
  const r = String(ref);
  for (const mod of listModules()) {
    const fn = mod.localPreviewRows;
    if (!fn) continue;
    const own = fn(project, r);
    if (own) return own;
    // Lazy import avoided: accountStore never imports this module (no cycle).
    for (const sibling of useAccountStore.getState().account.projects) {
      if (sibling.id === project.id) continue;
      const rows = fn(sibling, r);
      if (rows) return rows;
    }
  }
  return null;
}

/**
 * Resolve a SourceRef against a project:
 *  - "pack:<id>" → Project source: table → its rows, config → its object
 *  - "<plugin>:<source>" → module-local rows (authoring state, live while
 *    editing) → live snapshot (if cached)
 *  - unknown / malformed → undefined
 *
 * Local module rows win over the server snapshot (they're what WILL be
 * deployed). The legacy imported-connector sample fallback was removed
 * 2026-07-17 — server-reported sources + snapshots superseded it.
 */
export function resolveSourceRef(
  ref: SourceRef,
  project: Project,
  snapshots?: SourceSnapshots,
): unknown {
  const r = String(ref);
  if (r === "" || !r.includes(":")) return undefined;
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = project.dataSources.find((d) => d.id === (id as Project["dataSources"][number]["id"]));
    if (!ds) return undefined;
    return ds.shape === "table" ? ds.rows : ds.value;
  }
  const local = moduleLocalRows(project, r);
  if (local) return local;
  const owned = ownedSourceRows(project, r);
  if (owned) return owned;
  return snapshots?.[r];
}

/**
 * Rows a module-owned project supplies for its OWN namespace.
 *
 * An Add-on's project declares its owner in the manifest (`module: boutique`,
 * cf. ADR addon-owned-project-roots) and holds the module's data as ordinary
 * Project sources (ADR bare-data-files): the boutique catalogue is the `categories`
 * table source, and the plugin's `boutique:categories` fetcher reads exactly
 * those files at runtime. So for a project owned by `<ns>`, `<ns>:<id>` and the
 * project source `<id>` are the same rows — resolving them here is what makes a
 * canvas preview work OFFLINE, instead of waiting for a live server snapshot.
 *
 * Scoped to the owning project on purpose: a foreign project must not answer
 * for a namespace it does not own.
 */
function ownedSourceRows(project: Project, ref: string): unknown[] | null {
  const [ns, id] = ref.split(":", 2);
  if (!ns || !id || project.ownerModule !== ns) return null;
  const ds = project.dataSources.find((d) => String(d.id) === id);
  if (!ds || ds.shape !== "table") return null;
  return Array.isArray(ds.rows) ? ds.rows : null;
}

/** Sample values for the builtin implicit `{player}` (runtime: the viewing player). */
export const SAMPLE_PLAYER_NAME = "Steve";
export const SAMPLE_PLAYER_UUID = "8667ba71-b85a-4004-af54-457a9734eed7";
export const SAMPLE_PLAYER_WORLD = "world";

/**
 * Build a sample Player value for previews. The custom `toString` makes a
 * bare `{player}` render as the name (mirrors the runtime, where a Player
 * arg resolves to the player's name).
 */
export function makeSamplePlayer(name: string = SAMPLE_PLAYER_NAME): Record<string, unknown> {
  return { name, uuid: SAMPLE_PLAYER_UUID, world: SAMPLE_PLAYER_WORLD, toString: () => name };
}

/**
 * Build the preview scope for a menu by walking its contextInputs:
 *  - primitive → coerce default to its declared type
 *  - sourceRef → resolveSourceRef
 *
 * The builtin `player` (the viewing player at runtime) is seeded unless the
 * menu declares a contextInput with that name — caller arg wins, like the
 * plugin runtime.
 *
 * Used by MenuGroup and ItemTooltip preview rendering. Replaces the
 * pre-Plan-C1 sampleContext blob.
 */
export function buildPreviewScope(
  menu: Menu,
  project: Project,
  snapshots?: SourceSnapshots,
  /** Per-menu preview context (the canvas "preview as…" selector): overrides
   *  primitive input values, feeds `{arg}` interpolation in source filters,
   *  and may carry WHOLE objects (a caller row passed as `cat: {cat}`). */
  previewArgs?: Record<string, unknown>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  // Primitives first: their values feed the {arg} tokens in source shaping,
  // regardless of declaration order.
  for (const input of menu.contextInputs ?? []) {
    if (input.kind !== "primitive") continue;
    const override = previewArgs?.[input.name];
    scope[input.name] =
      override !== undefined && override !== ""
        ? typeof override === "string"
          ? coerceDefault(override, input.type as "player" | "string" | "integer" | "number" | "boolean")
          : override
        : coerceDefault(
            input.default,
            input.type as "player" | "string" | "integer" | "number" | "boolean",
          );
  }
  // Undeclared preview args (menus may consume {args} without declaring
  // inputs — and whole-object call-context rows) go straight into scope so
  // titles/lore render them.
  for (const [k, v] of Object.entries(previewArgs ?? {})) {
    if (!(k in scope)) scope[k] = v;
  }
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") continue;
    const rows = resolveSourceRef(input.ref, project, snapshots);
    scope[input.name] = Array.isArray(rows)
      ? applyShaping(rows, input, { ...scope, ...(previewArgs ?? {}) })
      : rows;
  }
  if (!(menu.contextInputs ?? []).some((i) => i.name === "player")) {
    scope.player = makeSamplePlayer();
  }
  return scope;
}

const ARG_TOKEN_RE = /\{([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\}/g;

/** Interpolate `{arg}` tokens; null when a token has no (non-empty) value —
 *  the preview then SKIPS that filter entry instead of matching nothing. */
function interpolateArgs(template: string, args: Record<string, unknown>): string | null {
  let unresolved = false;
  const out = template.replace(ARG_TOKEN_RE, (_m, name: string) => {
    const v = name.includes(".") ? lookupPath(args, name) : args[name];
    if (v === undefined || v === null || v === "") {
      unresolved = true;
      return "";
    }
    return String(v);
  });
  return unresolved ? null : out;
}

/**
 * Mirror of the plugin's ContextBinder shaping for canvas previews: equality
 * filters (string compare on the interpolated value), sort (numeric when both
 * sides parse, byte-order string compare otherwise — never localeCompare),
 * then limit. A filter entry whose `{arg}` has no preview value yet is
 * skipped, so an unparameterized preview shows the full source.
 */
function applyShaping(
  rows: unknown[],
  input: Extract<NonNullable<Menu["contextInputs"]>[number], { kind: "sourceRef" }>,
  args: Record<string, unknown>,
): unknown[] {
  let out = rows;
  for (const [field, template] of Object.entries(input.filter ?? {})) {
    const wanted = interpolateArgs(template, args);
    if (wanted === null) continue;
    out = out.filter((r) => String((r as Record<string, unknown>)?.[field]) === wanted);
  }
  const by = input.sort?.by;
  if (by) {
    const dir = input.sort?.direction === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const av = (a as Record<string, unknown>)?.[by];
      const bv = (b as Record<string, unknown>)?.[by];
      const an = Number(av);
      const bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
      const as = String(av);
      const bs = String(bv);
      return (as < bs ? -1 : as > bs ? 1 : 0) * dir;
    });
  }
  if (input.limit != null && input.limit >= 0) out = out.slice(0, input.limit);
  return out;
}

const previewCache = new AstCache(256);

/**
 * Render a template string for canvas preview. Uses the full expression
 * evaluator (ternary, comparisons, arithmetic, method calls) instead of
 * the simple regex-based resolvePlaceholders, so `{x > 1 ? "★" : ""}` etc.
 * work in lore/title previews exactly as they would at runtime.
 */
export function renderPreview(
  template: string,
  ctx: Record<string, unknown>,
  project: Project,
  activeLang: string,
): string {
  const scope = new Scope(ctx);
  return renderTemplate(template, {
    scope,
    cache: previewCache,
    projectId: project.id,
    projectVersion: 0,
    i18nLookup: (key) => {
      const entry = project.i18nKeys[key as I18nKey];
      if (!entry) return undefined;
      return entry[activeLang] ?? entry[project.defaultLang] ?? undefined;
    },
  });
}

function coerceDefault(
  value: string | undefined,
  type: "player" | "string" | "integer" | "number" | "boolean",
): unknown {
  if (type === "player") {
    return makeSamplePlayer(value === undefined || value === "" ? undefined : value);
  }
  if (value === undefined || value === "") {
    switch (type) {
      case "string":
        return "";
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
    }
  }
  switch (type) {
    case "integer":
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return value === "true";
    default:
      return value;
  }
}
