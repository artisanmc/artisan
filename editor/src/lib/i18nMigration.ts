import type { LText } from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";

/**
 * Walk a legacy project object whose user-facing strings are still plain
 * `string`s (or arrays of strings for lore) and rewrite them in place
 * to `LText` refs, populating `project.i18nKeys[key][defaultLang]` with the
 * original values.
 *
 * Idempotent-ish: a field that's already an `LText` (object with `.key`)
 * is left alone. So running this twice — or on a partially migrated
 * project — is safe.
 *
 * We intentionally type the input as `any` because by definition the
 * pre-migration shape doesn't match the current `Project` type (titles
 * are strings, not LTexts) and modeling both shapes in TS would cost
 * more than it returns.
 */
// biome-ignore lint/suspicious/noExplicitAny: legacy shape is by definition different from current
export function migrateProjectToI18n(project: any, fallbackDefaultLang: string): void {
  if (!project || typeof project !== "object") return;
  if (!project.i18nKeys || typeof project.i18nKeys !== "object") project.i18nKeys = {};
  if (typeof project.defaultLang !== "string" || !project.defaultLang) {
    project.defaultLang = fallbackDefaultLang;
  }

  const lang: string = project.defaultLang;
  // biome-ignore lint/suspicious/noExplicitAny: legacy field could be string | LText
  const lift = (value: any): LText | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "object" && typeof value.key === "string") return value as LText;
    if (typeof value !== "string") return undefined;
    const key = newI18nKey();
    project.i18nKeys[key] = { [lang]: value };
    return { key };
  };

  for (const menu of project.menus ?? []) {
    if (typeof menu.title === "string") menu.title = lift(menu.title);
    for (const layer of menu.layers ?? []) {
      for (const el of layer.elements ?? []) {
        for (const appearance of el.appearances ?? []) {
          if (typeof appearance.title === "string") appearance.title = lift(appearance.title);
          if (Array.isArray(appearance.lore)) {
            appearance.lore = appearance.lore
              .map((line: unknown) => (typeof line === "string" ? lift(line) : line))
              .filter((x: unknown) => x !== undefined);
          }
          if (appearance.click && typeof appearance.click === "object") {
            for (const handler of Object.values(appearance.click)) {
              if (handler && typeof handler === "object" && "steps" in handler) {
                migrateStepsI18n((handler as { steps: unknown[] }).steps ?? [], lift);
              }
            }
          }
        }
      }
    }
  }
  for (const cmd of project.commands ?? []) {
    migrateStepsI18n(cmd.steps ?? [], lift);
  }
  for (const tpl of project.templates ?? []) {
    for (const appearance of tpl.appearances ?? []) {
      if (typeof appearance.title === "string") appearance.title = lift(appearance.title);
      if (Array.isArray(appearance.lore)) {
        appearance.lore = appearance.lore
          .map((line: unknown) => (typeof line === "string" ? lift(line) : line))
          .filter((x: unknown) => x !== undefined);
      }
    }
  }
}

function migrateStepsI18n(
  steps: unknown[],
  // biome-ignore lint/suspicious/noExplicitAny: legacy field could be string | LText
  lift: (value: any) => LText | undefined,
): void {
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as { kind?: string; action?: { type?: string; text?: unknown; title?: unknown; subtitle?: unknown }; cases?: unknown[]; else?: unknown[] };
    if (s.kind === "action" && s.action) {
      const a = s.action as { type?: string; text?: unknown; title?: unknown; subtitle?: unknown };
      if (a.type === "send_message" && typeof a.text === "string") {
        a.text = lift(a.text);
      } else if (a.type === "show_title") {
        if (typeof a.title === "string") a.title = lift(a.title);
        if (typeof a.subtitle === "string") a.subtitle = lift(a.subtitle);
      }
    } else if (s.kind === "if") {
      for (const c of s.cases ?? []) {
        if (c && typeof c === "object" && Array.isArray((c as { steps?: unknown[] }).steps)) {
          migrateStepsI18n((c as { steps: unknown[] }).steps, lift);
        }
      }
      if (Array.isArray(s.else)) migrateStepsI18n(s.else, lift);
    }
  }
}
