import type { Action, DialogId, I18nKey, LText, MenuId, Step } from "@/domain/types";
import type { DslAction, DslStep, DslText } from "./ast";
import { parseActionDsl } from "./parser";
import { printActionDsl } from "./printer";

/**
 * Editor adapter: DSL AST ({@link DslStep}) ↔ domain {@link Step}. Cf. ADR
 * `action-dsl`. The DSL keeps its own typed verbs ({@link DslAction}); the domain
 * action is the keyed wire's `{name, value}` (ADR `extensible-document-kinds`, W4),
 * so each verb maps to its wire name and canonical value here — `paginate next` is
 * `pagination_next`, `set x = e` is `set_arg {arg, value}`, `run_command … as player`
 * collapses to the bare command like the wire codec does.
 *
 * The domain carries action text as an `LText` (`{key}`), which cannot itself
 * distinguish an inline literal from an `@key` reference — so the conversion
 * between {@link DslText} and {@link LText} is injected. Two conventions live on
 * top of the same structural mapping:
 *  - **Data-source** (the `@`-prefix default): a reference becomes `@<key>`, a
 *    literal stays verbatim (the `literalSteps` convention). Used where action
 *    text is a literal disk value, not a registered Key site.
 *  - **Project-aware** ({@link stepsToDsl}/{@link dslToSteps}): menu / command /
 *    dialog action text IS a registered Key site, so an `LText` whose key is in
 *    `Project.i18nKeys` serializes as `@key`; anything else falls back to a
 *    literal (resolved via `getText`).
 */

const REF_PREFIX = "@";

/** DSL text → domain LText. */
export type TextToLText = (t: DslText) => LText;
/** Domain LText → DSL text. */
export type LTextToText = (l: LText) => DslText;

const defaultTextToLText: TextToLText = (t) => ({
  key: ("lit" in t ? t.lit : REF_PREFIX + t.ref) as I18nKey,
});

const defaultLTextToText: LTextToText = (l) => {
  const k = String(l.key);
  return k.startsWith(REF_PREFIX) ? { ref: k.slice(1) } : { lit: k };
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `{k: v}` without the undefined entries; null when nothing is left. */
function compact(o: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length === 0 ? null : out;
}

/** The map when more than the primary is set, the primary's value otherwise. */
function primaryOr(primary: string, o: Record<string, unknown>): unknown {
  const c = compact(o);
  if (c === null) return null;
  const keys = Object.keys(c);
  return keys.length === 1 && keys[0] === primary ? c[primary] : c;
}

function openTail(a: { clearContext?: boolean; context?: Record<string, string> }) {
  return {
    ...(a.context && Object.keys(a.context).length > 0 ? { context: a.context } : {}),
    ...(a.clearContext ? { clear_context: true } : {}),
  };
}

export function dslActionToAction(a: DslAction, toLText: TextToLText): Action {
  switch (a.type) {
    case "send_message":
    case "broadcast":
      return { name: a.type, value: toLText(a.text) };
    case "show_title":
      return {
        name: "show_title",
        value: primaryOr("title", {
          title: toLText(a.title),
          subtitle: a.subtitle ? toLText(a.subtitle) : undefined,
          fade_in: a.fadeIn,
          stay: a.stay,
          fade_out: a.fadeOut,
        }),
      };
    case "open_menu":
      return {
        name: "open_menu",
        value: primaryOr("menu_id", { menu_id: a.menuId, ...openTail(a) }),
      };
    case "open_dialog":
      return {
        name: "open_dialog",
        value: primaryOr("dialog_id", { dialog_id: a.dialogId, ...openTail(a) }),
      };
    case "close_menu":
    case "close_dialog":
    case "open_previous_menu":
      return { name: a.type, value: null };
    case "run_command":
      return {
        name: "run_command",
        value: a.as === "console" ? { command: a.command, as: "console" } : a.command,
      };
    case "give_item":
    case "take_item":
      return {
        name: a.type,
        value: a.count === 1 ? a.material : { material: a.material, count: a.count },
      };
    case "take_money":
    case "give_money":
    case "give_xp":
    case "give_level":
      return { name: a.type, value: a.amount };
    case "play_sound":
      return {
        name: "play_sound",
        value: primaryOr("sound", { sound: a.sound, volume: a.volume, pitch: a.pitch }),
      };
    case "teleport":
      return {
        name: "teleport",
        value: compact({ world: a.world, x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch }),
      };
    case "paginate":
      return { name: `pagination_${a.direction}`, value: a.targetElementId ?? null };
    case "set_arg":
      return { name: "set_arg", value: { arg: a.arg, value: a.value } };
    case "set_arg_cycle_next":
    case "set_arg_cycle_prev":
      return { name: a.type, value: { arg: a.arg, list: a.list } };
    case "run_actions":
      return { name: "run_actions", value: a.actions };
    case "module":
      return { name: a.name, value: a.value ?? null };
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const optNum = (v: unknown): number | undefined =>
  v === undefined || v === null ? undefined : num(v);
const asLText = (v: unknown): LText =>
  isRecord(v) && typeof v.key === "string" ? (v as unknown as LText) : { key: str(v) as I18nKey };

/** The argument map of a core value: a scalar is the primary's. */
function args(value: unknown, primary: string): Record<string, unknown> {
  if (value == null) return {};
  if (isRecord(value) && !(typeof value.key === "string" && Object.keys(value).length === 1))
    return value;
  return { [primary]: value };
}

export function actionToDslAction(a: Action, toText: LTextToText): DslAction {
  const v = a.value;
  switch (a.name) {
    case "send_message":
    case "broadcast":
      return { type: a.name, text: toText(asLText(args(v, "text").text)) };
    case "show_title": {
      const o = args(v, "title");
      return {
        type: "show_title",
        title: toText(asLText(o.title)),
        ...(o.subtitle !== undefined ? { subtitle: toText(asLText(o.subtitle)) } : {}),
        ...(o.fade_in !== undefined ? { fadeIn: num(o.fade_in) } : {}),
        ...(o.stay !== undefined ? { stay: num(o.stay) } : {}),
        ...(o.fade_out !== undefined ? { fadeOut: num(o.fade_out) } : {}),
      };
    }
    case "open_menu": {
      const o = args(v, "menu_id");
      return {
        type: "open_menu",
        menuId: str(o.menu_id) as MenuId,
        ...(isRecord(o.context) ? { context: o.context as Record<string, string> } : {}),
        ...(o.clear_context === true ? { clearContext: true } : {}),
      };
    }
    case "open_dialog": {
      const o = args(v, "dialog_id");
      return {
        type: "open_dialog",
        dialogId: str(o.dialog_id) as DialogId,
        ...(isRecord(o.context) ? { context: o.context as Record<string, string> } : {}),
        ...(o.clear_context === true ? { clearContext: true } : {}),
      };
    }
    case "close_menu":
    case "close_dialog":
    case "open_previous_menu":
      return { type: a.name };
    case "run_command": {
      const o = args(v, "command");
      return {
        type: "run_command",
        command: str(o.command),
        as: o.as === "console" ? "console" : "player",
      };
    }
    case "give_item":
    case "take_item": {
      const o = args(v, "material");
      return {
        type: a.name,
        material: str(o.material),
        count: o.count === undefined ? 1 : num(o.count),
      };
    }
    case "take_money":
    case "give_money":
    case "give_xp":
    case "give_level":
      return { type: a.name, amount: num(args(v, "amount").amount) };
    case "play_sound": {
      const o = args(v, "sound");
      return {
        type: "play_sound",
        sound: str(o.sound),
        ...(o.volume !== undefined ? { volume: num(o.volume) } : {}),
        ...(o.pitch !== undefined ? { pitch: num(o.pitch) } : {}),
      };
    }
    case "teleport": {
      const o = isRecord(v) ? v : {};
      return {
        type: "teleport",
        world: str(o.world),
        x: num(o.x ?? 0),
        y: num(o.y ?? 0),
        z: num(o.z ?? 0),
        ...(optNum(o.yaw) !== undefined ? { yaw: num(o.yaw) } : {}),
        ...(optNum(o.pitch) !== undefined ? { pitch: num(o.pitch) } : {}),
      };
    }
    case "pagination_next":
    case "pagination_prev": {
      const target = args(v, "element_id").element_id;
      return {
        type: "paginate",
        direction: a.name === "pagination_next" ? "next" : "prev",
        ...(typeof target === "string" && target !== ""
          ? { targetElementId: target as never }
          : {}),
      };
    }
    case "set_arg": {
      const o = isRecord(v) ? v : {};
      return { type: "set_arg", arg: str(o.arg), value: str(o.value) };
    }
    case "set_arg_cycle_next":
    case "set_arg_cycle_prev": {
      const o = isRecord(v) ? v : {};
      return { type: a.name, arg: str(o.arg), list: str(o.list) };
    }
    case "run_actions":
      return { type: "run_actions", actions: str(args(v, "actions").actions) };
    default:
      return { type: "module", name: a.name, value: v };
  }
}

export function dslStepsToSteps(
  steps: DslStep[],
  toLText: TextToLText = defaultTextToLText,
): Step[] {
  return steps.map((s) =>
    s.kind === "action"
      ? { kind: "action", action: dslActionToAction(s.action, toLText) }
      : {
          kind: "if",
          cases: s.cases.map((c) => ({
            conditions: c.conditions,
            ...(c.joins ? { joins: c.joins } : {}),
            steps: dslStepsToSteps(c.steps, toLText),
          })),
          ...(s.else ? { else: dslStepsToSteps(s.else, toLText) } : {}),
        },
  );
}

export function stepsToDslSteps(
  steps: Step[],
  toText: LTextToText = defaultLTextToText,
): DslStep[] {
  return steps.map((s) =>
    s.kind === "action"
      ? { kind: "action", action: actionToDslAction(s.action, toText) }
      : {
          kind: "if",
          cases: s.cases.map((c) => ({
            conditions: c.conditions,
            ...(c.joins ? { joins: c.joins } : {}),
            steps: stepsToDslSteps(c.steps, toText),
          })),
          ...(s.else ? { else: stepsToDslSteps(s.else, toText) } : {}),
        },
  );
}

/** Raw DSL string → domain steps (data-source `@`-convention). Throws on parse error. */
export function parseToSteps(dsl: string, toLText: TextToLText = defaultTextToLText): Step[] {
  return dslStepsToSteps(parseActionDsl(dsl), toLText);
}

/** Domain steps → canonical DSL string (data-source `@`-convention). */
export function printFromSteps(steps: Step[], toText: LTextToText = defaultLTextToText): string {
  return printActionDsl(stepsToDslSteps(steps, toText));
}
