import type { Condition, I18nKey, LText, ProjectId } from "@/domain/types";
import { conditionsToStructured } from "@/lib/actions/structuredSteps";
import { newI18nKey } from "@/lib/i18n";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { makeStepConverter } from "@/schema/actionV1ToDomain";
import {
  type OverlayPreviewContent,
  type PackImage,
  type PackImageByBottom,
  overlayPackImages,
  readOverlayLayout,
} from "@artisan/editor-sdk";

/**
 * A server HUD (`huds/<id>.yml`, `schema: hud/v1`, ADR `server-huds`): what stays drawn on the
 * players' screens in one overlay slot, at a priority, checked again every `refresh` ticks.
 * Permanent (on, no conditions), conditional (on, `when`) or temporary (`enabled: false`, shown
 * by `show_hud`). Twin of `Hud.kt` on the plugin's side.
 */
export type HudSlot = "boss_bar" | "action_bar";

export interface Hud {
  id: string;
  projectId: ProjectId;
  /** false: drawn only while a `show_hud` lasts. */
  enabled: boolean;
  slot: HudSlot;
  priority: number;
  /** Ticks between two checks; 0: on a change of Variable only. */
  refresh: number;
  /** All required (the file's `when:` list). */
  conditions: Condition[];
  /** The layout as the file holds it: a YAML list of `image` and `text` layers. */
  layout: unknown[];
  /** The MiniMessage of each text layer, by its name. */
  texts: Record<string, string>;
  /** Keys the editor does not edit, written back as read. */
  wire?: Record<string, unknown>;
}

export const HUD_KIND = {
  kind: "hud",
  dir: "huds",
  idPrefix: "h_",
  schemaVersion: "hud/v1",
  rank: 5,
} as const;

export const DEFAULT_PRIORITY = 100;
export const DEFAULT_REFRESH = 20;
export const MIN_REFRESH = 5;
export const MAX_REFRESH = 1200;

/** How long a HUD stays: what the page offers in place of `enabled` and `when`. */
export type HudLifetime = "permanent" | "conditional" | "temporary";

export function lifetimeOf(hud: Hud): HudLifetime {
  if (!hud.enabled) return "temporary";
  return hud.conditions.length > 0 ? "conditional" : "permanent";
}

/** A new HUD: one line at the top of the screen, the player's name. */
export const HUD_START: unknown[] = [{ text: "line", x: -100, y: 4, width: 200, align: "center" }];
export const HUD_START_TEXTS: Record<string, string> = { line: "<white>{player}" };

const MODELLED = new Set([
  "schema",
  "id",
  "enabled",
  "slot",
  "priority",
  "refresh",
  "when",
  "layout",
  "texts",
]);

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

const isMap = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function int(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** `refresh` as the server reads it: 0, or within MIN..MAX; anything else the default. */
export function readRefresh(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_REFRESH;
  const n = int(value);
  if (n === undefined) return DEFAULT_REFRESH;
  if (n === 0) return 0;
  return Math.min(MAX_REFRESH, Math.max(MIN_REFRESH, n));
}

/** The names of the layout's text layers, in drawing order. */
export function textLayerNames(layout: unknown[]): string[] {
  return readOverlayLayout(layout)
    .layers.filter((l) => l.kind === "text")
    .map((l) => l.name);
}

export interface HudParseResult {
  doc: Hud;
  i18nKeys: Record<string, Record<string, string>>;
  unsupported: string[];
}

/** `hud/v1` → Hud. A `list` or `image_slot` layer is kept in the layout, and named unsupported. */
export function hudFromFile(src: Json, opts: { projectId: string; lang: string }): HudParseResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];
  // A condition's text is minted like a Trigger's (a HUD's conditions rarely carry one).
  const text = (raw: string | Record<string, string> | undefined): LText => {
    const key = newI18nKey();
    i18nKeys[key] = isMap(raw)
      ? { ...(raw as Record<string, string>) }
      : { [opts.lang]: raw ?? "" };
    return { key };
  };
  const ref = (key: string): LText => ({ key: key as I18nKey });
  const convert = makeStepConverter({ text, ref, pushUnsupported: (s) => unsupported.push(s) });
  const rawWhen: unknown[] = Array.isArray(src.when)
    ? src.when
    : src.when != null
      ? [src.when]
      : [];
  const layout = Array.isArray(src.layout) ? src.layout : [];
  for (const layer of readOverlayLayout(layout).layers)
    if (layer.kind === "list" || layer.kind === "image_slot")
      unsupported.push(`layout: ${layer.kind} ${layer.name}`);
  const rawTexts = isMap(src.texts) ? src.texts : {};
  const texts: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawTexts))
    if (value !== null && value !== undefined) texts[name] = String(value);
  const priority = int(src.priority);
  const wire = Object.fromEntries(Object.entries(src).filter(([k]) => !MODELLED.has(k)));
  const doc: Hud = {
    id: String(src.id ?? ""),
    projectId: opts.projectId as ProjectId,
    enabled: src.enabled !== false && String(src.enabled).toLowerCase() !== "false",
    slot: src.slot === "action_bar" ? "action_bar" : "boss_bar",
    priority: priority ?? DEFAULT_PRIORITY,
    refresh: readRefresh(src.refresh),
    conditions: rawWhen.flatMap((c) => convert.condition(c as Json) ?? []),
    layout,
    texts,
    ...(Object.keys(wire).length > 0 ? { wire } : {}),
  };
  return { doc, i18nKeys, unsupported };
}

/** Hud → canonical `hud/v1`, `id` included (the host strips it). Texts of no layer are dropped. */
export function hudToFile(hud: Hud): Record<string, unknown> {
  const names = new Set(textLayerNames(hud.layout));
  const texts = Object.fromEntries(
    Object.entries(hud.texts).filter(([name, value]) => names.has(name) && value !== ""),
  );
  return {
    schema: HUD_KIND.schemaVersion,
    id: hud.id,
    ...(hud.enabled ? {} : { enabled: false }),
    ...(hud.slot === "boss_bar" ? {} : { slot: hud.slot }),
    ...(hud.priority === DEFAULT_PRIORITY ? {} : { priority: hud.priority }),
    ...(hud.refresh === DEFAULT_REFRESH ? {} : { refresh: hud.refresh }),
    ...(hud.conditions.length > 0 ? { when: conditionsToStructured(hud.conditions) } : {}),
    ...hud.wire,
    layout: hud.layout,
    ...(Object.keys(texts).length > 0 ? { texts } : {}),
  };
}

/**
 * What a HUD's file asks of the pack: each `image` layer where the layout draws it. Twin of
 * `Hud.packImages` (Kotlin): same images, same order.
 */
export function hudPackImages(src: Record<string, unknown>): (PackImage | PackImageByBottom)[] {
  const layers = readOverlayLayout(Array.isArray(src.layout) ? src.layout : []).layers;
  return overlayPackImages(layers.filter((l) => l.kind === "image"));
}

/**
 * A text as the composer shows it: each `{path}` the catalog has a sample for replaced by it,
 * the others left as written (a Variable with no value in the editor).
 */
export function sampleText(template: string, entries: readonly PlaceholderEntry[]): string {
  const samples = new Map(
    entries
      .filter((e) => e.sample !== null && e.sample !== undefined)
      .map((e) => [e.path, String(e.sample)]),
  );
  return template.replace(/\{([^{}]+)\}/g, (all, path: string) => samples.get(path.trim()) ?? all);
}

/** What each text layer shows in the composer. */
export function hudPreview(hud: Hud, entries: readonly PlaceholderEntry[]): OverlayPreviewContent {
  const text: Record<string, string> = {};
  for (const name of textLayerNames(hud.layout))
    text[name] = sampleText(hud.texts[name] ?? "", entries);
  return { text };
}

/** A name for a new text layer: `text_<n>`, the first the layout does not have. */
export function nextTextName(layout: unknown[]): string {
  const names = new Set(textLayerNames(layout));
  for (let n = names.size + 1; ; n++) if (!names.has(`text_${n}`)) return `text_${n}`;
}
