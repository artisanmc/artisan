import type { I18nKey, Menu, Project, SourceRef } from "@/domain/types";
import { AstCache } from "@/lib/expr/cache";
import { Scope } from "@/lib/expr/scope";
import { renderTemplate } from "@/lib/expr/template/renderer";

/**
 * Resolve a SourceRef against a pack:
 *  - "pack:<id>" → pack.dataSources[id].value
 *  - "<plugin>:<source>" → pack.importedConnectors[ref].sample
 *  - unknown / malformed → undefined
 *
 * Cf. spec §3.5.
 */
export function resolveSourceRef(ref: SourceRef, pack: Project): unknown {
  const r = String(ref);
  if (r === "" || !r.includes(":")) return undefined;
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = pack.dataSources.find((d) => d.id === (id as Project["dataSources"][number]["id"]));
    return ds?.value;
  }
  const c = pack.importedConnectors.find((x) => x.ref === r);
  return c?.sample;
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
export function buildPreviewScope(menu: Menu, pack: Project): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      scope[input.name] = coerceDefault(
        input.default,
        input.type as "player" | "string" | "integer" | "number" | "boolean",
      );
    } else {
      scope[input.name] = resolveSourceRef(input.ref, pack);
    }
  }
  if (!(menu.contextInputs ?? []).some((i) => i.name === "player")) {
    scope.player = makeSamplePlayer();
  }
  return scope;
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
  pack: Project,
  activeLang: string,
): string {
  const scope = new Scope(ctx);
  return renderTemplate(template, {
    scope,
    cache: previewCache,
    projectId: pack.id,
    projectVersion: 0,
    i18nLookup: (key) => {
      const entry = pack.i18nKeys[key as I18nKey];
      if (!entry) return undefined;
      return entry[activeLang] ?? entry[pack.defaultLang] ?? undefined;
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
