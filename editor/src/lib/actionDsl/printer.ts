import type { Condition } from "@/domain/types";
import type { DslAction, DslStep, DslText } from "./ast";

/**
 * Action DSL printer. Cf. ADR `action-dsl`. `printActionDsl(steps)` → the
 * canonical text form. Inverse of the parser: `parse(print(steps))` deep-equals
 * `steps`, and `print(parse(dsl))` equals the canonical DSL. 2-space indent.
 */

const INDENT = "  ";

export function printActionDsl(steps: DslStep[]): string {
  return printBlock(steps, 0).join("\n");
}

function printBlock(steps: DslStep[], depth: number): string[] {
  const out: string[] = [];
  for (const step of steps) {
    if (step.kind === "action") {
      out.push(INDENT.repeat(depth) + printAction(step.action));
      continue;
    }
    step.cases.forEach((c, i) => {
      const kw = i === 0 ? "if" : "else if";
      out.push(`${INDENT.repeat(depth)}${kw} ${printFlat(c.conditions, c.joins)}:`);
      out.push(...printBlock(c.steps, depth + 1));
    });
    if (step.else) {
      out.push(`${INDENT.repeat(depth)}else:`);
      out.push(...printBlock(step.else, depth + 1));
    }
  }
  return out;
}

function printText(t: DslText): string {
  return "lit" in t ? JSON.stringify(t.lit) : `@${t.ref}`;
}

function num(n: number): string {
  return String(n);
}

function printAction(a: DslAction): string {
  switch (a.type) {
    case "broadcast":
      return `broadcast ${printText(a.text)}`;
    case "send_message":
      return `send_message ${printText(a.text)}`;
    case "give_item":
      return `give_item ${a.material} ${a.count}`;
    case "take_item":
      return `take_item ${a.material} ${a.count}`;
    case "give_money":
      return `give_money ${num(a.amount)}`;
    case "take_money":
      return `take_money ${num(a.amount)}`;
    case "give_xp":
      return `give_xp ${a.amount}`;
    case "give_level":
      return `give_level ${a.amount}`;
    case "run_command":
      return `run_command ${JSON.stringify(a.command)} as ${a.as}`;
    case "play_sound":
      return `play_sound ${a.sound}${opt(" vol=", a.volume)}${opt(" pitch=", a.pitch)}`;
    case "teleport":
      return `teleport ${a.world} ${num(a.x)} ${num(a.y)} ${num(a.z)}${opt(" yaw=", a.yaw)}${opt(" pitch=", a.pitch)}`;
    case "show_title":
      return `show_title ${printText(a.title)}${a.subtitle ? ` ${printText(a.subtitle)}` : ""}${opt(" fadeIn=", a.fadeIn)}${opt(" stay=", a.stay)}${opt(" fadeOut=", a.fadeOut)}`;
    case "open_menu":
      return `open_menu ${a.menuId}${menuTail(a.clearContext, a.context)}`;
    case "open_dialog":
      return `open_dialog ${a.dialogId}${menuTail(a.clearContext, a.context)}`;
    case "close_menu":
      return "close_menu";
    case "close_dialog":
      return "close_dialog";
    case "open_previous_menu":
      return "open_previous_menu";
    case "paginate":
      return `paginate ${a.direction}${a.targetElementId ? ` ${a.targetElementId}` : ""}`;
    case "run_actions":
      return `run_actions ${a.actions}`;
    case "set_arg":
      return `set ${a.arg} = ${a.value}`;
    case "set_arg_cycle_next":
      return `cycle ${a.arg} in ${a.list}`;
    case "set_arg_cycle_prev":
      return `cycle prev ${a.arg} in ${a.list}`;
    case "module":
      // The DSL (read-only since ADR structured-action-wire) has no syntax for a
      // module's action: printed as its wire, for reading only.
      return a.value == null ? a.name : `${a.name} ${JSON.stringify(a.value)}`;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

function opt(prefix: string, n: number | undefined): string {
  return n === undefined ? "" : `${prefix}${num(n)}`;
}

function menuTail(clear: boolean | undefined, context: Record<string, string> | undefined): string {
  let s = clear ? " clear" : "";
  if (context && Object.keys(context).length > 0) {
    s += ` with ${Object.entries(context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ")}`;
  }
  return s;
}

// Conditions

function printFlat(conditions: Condition[], joins: ("and" | "or")[] | undefined): string {
  let out = printAtom(conditions[0]!);
  for (let i = 1; i < conditions.length; i++) {
    out += ` ${joins?.[i - 1] ?? "and"} ${printAtom(conditions[i]!)}`;
  }
  return out;
}

const IDENT_RE = /^[A-Za-z0-9_.]+$/;
function arg(v: string): string {
  return IDENT_RE.test(v) ? v : JSON.stringify(v);
}

function printAtom(c: Condition): string {
  switch (c.type) {
    case "has_permission":
      return `has_permission(${arg(c.perm)})`;
    case "has_money":
      return `has_money(${num(c.amount)})`;
    case "has_item":
      return `has_item(${arg(c.material)}, ${c.count})`;
    case "has_xp":
      return `has_xp(${c.amount})`;
    case "has_level":
      return `has_level(${c.level})`;
    case "world_is":
      return `world_is(${arg(c.world)})`;
    case "random_chance":
      return `random_chance(${num(c.probability)})`;
    case "cooldown_passed":
      return `cooldown_passed(${arg(c.cooldown_id)})`;
    case "player_in_region":
      return `player_in_region(${arg(c.region)})`;
    case "has_var":
      return `has_var(${arg(c.var)})`;
    case "time_is":
      return `time_is(${typeof c.range === "string" ? c.range : `${c.range.from_ticks}-${c.range.to_ticks}`})`;
    case "pagination_at_first":
      return `pagination_at_first${c.elementId ? `(${arg(c.elementId)})` : ""}`;
    case "pagination_at_last":
      return `pagination_at_last${c.elementId ? `(${arg(c.elementId)})` : ""}`;
    case "placeholder_equals":
      return `${c.placeholder} == ${JSON.stringify(c.value)}`;
    case "placeholder_match":
      return `${c.placeholder} matches ${JSON.stringify(c.regex)}`;
    case "expression":
      return c.expr;
    case "not":
      return `not ${printAtom(c.of)}`;
    case "and":
      return `(${c.of.map(printAtom).join(" and ")})`;
    case "or":
      return `(${c.of.map(printAtom).join(" or ")})`;
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}
