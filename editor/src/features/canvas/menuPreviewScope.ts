import type { I18nKey, LText, Menu, Project, SourceRef } from "@/domain/types";
import { AstCache } from "@/lib/expr/cache";
import { Scope } from "@/lib/expr/scope";
import { renderTemplate } from "@/lib/expr/template/renderer";
import { getText } from "@/lib/i18n";
import { lookupPath } from "@/lib/placeholders";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { listModules } from "@artisan/editor-sdk";

/** Cached live-server snapshots keyed by ref (see serverSnapshotsStore). */
export type SourceSnapshots = Record<string, unknown[]>;

/**
 * Authoring-time rows a registered frontend module computes from a project's
 * moduleData (FrontendModule.localPreviewRows) — e.g. the boutique form's
 * items, so tiles/canvas update live while editing, before any deploy.
 *
 * Module data may live in a **sibling project** (the plugin merges module
 * files across ALL projects of the server at runtime — cf. BoutiqueModule
 * .reloadRepo), so after the current project we probe the store's other
 * projects. Null when no module owns the ref or no project holds local data.
 *
 * `serverRows` (the cached server snapshot of the ref) is passed on to the module
 * (SDK 1.12): a `mixed` source joins the player's state it holds to the draft's
 * definitions. `params` are the fetcher params the menu declares on its input
 * (`group: daily`), which the module applies like its fetcher does.
 */
export function moduleLocalRows(
  project: Project,
  ref: SourceRef | string,
  serverRows?: unknown[],
  params?: Record<string, string>,
): Record<string, unknown>[] | null {
  const r = String(ref);
  const ctx = {
    ...(Array.isArray(serverRows) ? { serverRows: serverRows as Record<string, unknown>[] } : {}),
    ...(params && Object.keys(params).length > 0 ? { params } : {}),
  };
  for (const mod of listModules()) {
    const fn = mod.localPreviewRows;
    if (!fn) continue;
    const forPreview = (p: Project) => ({
      ...p,
      dataSources: resolveLTexts(
        p.dataSources,
        p,
        useUiStore.getState().activeLang || p.defaultLang,
      ),
    });
    const own = fn(forPreview(project), r, ctx);
    if (own) return own;
    // Lazy import avoided: projectsStore never imports this module (no cycle).
    for (const sibling of useProjectsStore.getState().openProjects.projects) {
      if (sibling.id === project.id) continue;
      const rows = fn(forPreview(sibling), r, ctx);
      if (rows) return resolveRowTexts(rows, sibling);
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
 * deployed).
 */
export function resolveSourceRef(
  ref: SourceRef,
  project: Project,
  snapshots?: SourceSnapshots,
  params?: Record<string, string>,
): unknown {
  return resolveSourceRefWithOrigin(ref, project, snapshots, params).value;
}

/**
 * Where the preview rows of a source come from: `draft` = computed from the
 * project as edited (a Project source, a module's `localPreviewRows`, a
 * module-owned project's files); `deployed` = the server's last snapshot, so
 * the version the server runs; `none` = nothing to show yet.
 */
export type SourceRowsOrigin = "draft" | "deployed" | "none";

/** {@link resolveSourceRef}, telling where the value came from. */
export function resolveSourceRefWithOrigin(
  ref: SourceRef | string,
  project: Project,
  snapshots?: SourceSnapshots,
  params?: Record<string, string>,
): { value: unknown; origin: SourceRowsOrigin } {
  const r = String(ref);
  const none = { value: undefined, origin: "none" as const };
  if (r === "" || !r.includes(":")) return none;
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = project.dataSources.find(
      (d) => d.id === (id as Project["dataSources"][number]["id"]),
    );
    if (!ds) return none;
    return { value: ds.shape === "table" ? ds.rows : ds.value, origin: "draft" };
  }
  // Module rows are derived from the project's own files too, so they carry
  // domain LText nodes just like a Project source — resolve both the same way.
  const local = moduleLocalRows(project, r, snapshots?.[r], params);
  if (local) return { value: resolveRowTexts(local, project), origin: "draft" };
  const owned = ownedSourceRows(project, r);
  if (owned) return { value: owned, origin: "draft" };
  const snapshot = snapshots?.[r];
  return snapshot === undefined ? none : { value: snapshot, origin: "deployed" };
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
  if (!Array.isArray(ds.rows)) return null;
  // Domain rows hold ltext fields as LText nodes (`{ key }`); a consumer of a
  // source expects TEXT, the way the plugin's fetcher resolves it at bind time.
  // Handing the node through rendered `{"key":"sources.…"}` into titles.
  return resolveRowTexts(ds.rows, project);
}

/** Resolve every LText node of a row list to text in the active language. */
export function resolveRowTexts<T>(rows: T[], project: Project): T[] {
  const lang = useUiStore.getState().activeLang || project.defaultLang;
  return rows.map((r) => resolveLTexts(r, project, lang) as T);
}

/** True for an LText node — the domain's `{ key }` reference, nothing else. */
function isLText(v: unknown): v is { key: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === 1 &&
    typeof (v as { key?: unknown }).key === "string"
  );
}

/** Deep-resolve every LText node of a source row to its text in [lang]. */
function resolveLTexts(value: unknown, project: Project, lang: string): unknown {
  if (isLText(value)) return getText(project, value as LText, lang);
  if (Array.isArray(value)) return value.map((v) => resolveLTexts(v, project, lang));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveLTexts(v, project, lang);
    return out;
  }
  return value;
}

/** Sample values for the builtin implicit `{player}` (runtime: the viewing player). */
export const SAMPLE_PLAYER_NAME = "Steve";
export const SAMPLE_PLAYER_UUID = "8667ba71-b85a-4004-af54-457a9734eed7";
export const SAMPLE_PLAYER_WORLD = "world";
/** First seen 40 days ago, last seen 3 days 4 hours ago, 12 h 30 min of play. */
export const SAMPLE_FIRST_SEEN_AGO = 40 * 86_400_000;
export const SAMPLE_LAST_SEEN_AGO = 3 * 86_400_000 + 4 * 3_600_000;
export const SAMPLE_PLAYTIME = 12 * 3_600_000 + 30 * 60_000;

/**
 * Build a sample Player value for previews. The custom `toString` makes a
 * bare `{player}` render as the name (mirrors the runtime, where a Player
 * arg resolves to the player's name).
 */
export function makeSamplePlayer(name: string = SAMPLE_PLAYER_NAME): Record<string, unknown> {
  const now = Date.now();
  return {
    name,
    uuid: SAMPLE_PLAYER_UUID,
    world: SAMPLE_PLAYER_WORLD,
    // What the server reads from `artisan_players`: instants and the play time in milliseconds.
    first_seen: now - SAMPLE_FIRST_SEEN_AGO,
    last_seen: now - SAMPLE_LAST_SEEN_AGO,
    playtime: SAMPLE_PLAYTIME,
    toString: () => name,
  };
}

/**
 * Data source refs an element iterates or places directly (`iterates.source:
 * "ns:id"`, the runtime's direct-ref sugar) instead of naming a declared input.
 * Distinct, in element order.
 */
export function directSourceRefs(menu: Menu): string[] {
  const declared = new Set((menu.contextInputs ?? []).map((i) => i.name));
  const refs: string[] = [];
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      for (const source of [el.iterates?.source, el.places?.source]) {
        if (source?.includes(":") && !declared.has(source) && !refs.includes(source)) {
          refs.push(source);
        }
      }
    }
  }
  return refs;
}

/**
 * Build the preview scope for a menu by walking its contextInputs:
 *  - primitive → coerce default to its declared type
 *  - sourceRef → resolveSourceRef
 *  - then each direct ref of an element ({@link directSourceRefs}) → resolveSourceRef
 *
 * The builtin `player` (the viewing player at runtime) is seeded unless the
 * menu declares a contextInput with that name — caller arg wins, like the
 * plugin runtime.
 *
 * Used by MenuGroup and ItemTooltip preview rendering.
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
          ? coerceDefault(
              override,
              input.type as "player" | "string" | "integer" | "number" | "boolean",
            )
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
    const rows = resolveSourceRef(input.ref, project, snapshots, input.params);
    scope[input.name] = Array.isArray(rows)
      ? applyShaping(rows, input, { ...scope, ...(previewArgs ?? {}) })
      : rows;
  }
  // Direct refs resolve under their own key, as the runtime exposes them.
  for (const ref of directSourceRefs(menu)) {
    if (!(ref in scope)) scope[ref] = resolveSourceRef(ref as SourceRef, project, snapshots);
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
