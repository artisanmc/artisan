import type { Condition, DialogId, ElementId, MenuId } from "@/domain/types";

/**
 * DSL AST — the pure, Project-free representation the Action DSL parses to and
 * prints from. Cf. ADR `action-dsl`. It mirrors the domain `Step[]` (actions +
 * if/else-if/else over typed conditions) with two deliberate differences:
 *
 *  - text is an explicit {@link DslText} tagged union (`lit` vs `ref`) instead of
 *    an `LText`: the domain `LText` (a bare `{key}`) cannot tell a literal `"..."`
 *    apart from an `@key` reference, so a faithful text round-trip needs the tag;
 *  - an action is the DSL's own typed vocabulary ({@link DslAction}, one variant per
 *    verb, `paginate next` and `set x = …` included), where the domain `Action` is
 *    the generic `{name, value}` of the keyed wire. `domainSteps.ts` maps the two.
 *
 * The AST is locked by `testdata/action-dsl-conformance.json`; the codec itself
 * stays pure so the cross-stack fixtures never need a Project.
 */

/** A text argument: an inline literal, or a reference to an i18n key (`@key`). */
export type DslText = { lit: string } | { ref: string };

export type DslAction =
  | {
      type: "open_menu";
      menuId: MenuId;
      clearContext?: boolean;
      context?: Record<string, string>;
    }
  | { type: "close_menu" }
  | { type: "open_previous_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: DslText }
  | {
      type: "show_title";
      title: DslText;
      subtitle?: DslText;
      fadeIn?: number;
      stay?: number;
      fadeOut?: number;
    }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_item"; material: string; count: number }
  | { type: "take_money"; amount: number }
  | { type: "give_money"; amount: number }
  | { type: "give_xp"; amount: number }
  | { type: "give_level"; amount: number }
  | { type: "broadcast"; text: DslText }
  | { type: "play_sound"; sound: string; volume?: number; pitch?: number }
  | {
      type: "teleport";
      world: string;
      x: number;
      y: number;
      z: number;
      yaw?: number;
      pitch?: number;
    }
  | { type: "paginate"; direction: "next" | "prev"; targetElementId?: ElementId }
  | { type: "set_arg"; arg: string; value: string }
  | { type: "set_arg_cycle_next"; arg: string; list: string }
  | { type: "set_arg_cycle_prev"; arg: string; list: string }
  | {
      type: "open_dialog";
      dialogId: DialogId;
      context?: Record<string, string>;
      clearContext?: boolean;
    }
  | { type: "close_dialog" }
  | { type: "run_actions"; actions: string }
  /** A module's action: no DSL syntax, printed as its wire for reading only. */
  | { type: "module"; name: string; value: unknown };

export interface DslIfCase {
  conditions: Condition[];
  joins?: ("and" | "or")[];
  steps: DslStep[];
}

export type DslStep =
  | { kind: "action"; action: DslAction }
  | { kind: "if"; cases: DslIfCase[]; else?: DslStep[] };
