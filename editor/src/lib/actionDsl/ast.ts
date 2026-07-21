import type { Action, Condition } from "@/domain/types";

/**
 * DSL AST — the pure, Project-free representation the Action DSL parses to and
 * prints from. Cf. ADR `action-dsl`. It mirrors the domain `Step[]` (actions +
 * if/else-if/else over typed conditions) with ONE deliberate difference: text
 * is an explicit {@link DslText} tagged union (`lit` vs `ref`) instead of an
 * `LText`. The domain `LText` (a bare `{key}`) cannot tell a literal `"..."`
 * apart from an `@key` reference, so a faithful text round-trip needs the tag
 * here. The editor-side adapter maps `DslStep[]` ↔ domain `Step[]` (minting /
 * resolving i18n keys against the Project); the codec itself stays pure so the
 * cross-stack conformance fixtures never need a Project.
 */

/** A text argument: an inline literal, or a reference to an i18n key (`@key`). */
export type DslText = { lit: string } | { ref: string };

/** Actions that carry text differ from the domain by using {@link DslText}. */
export type DslAction =
  | Exclude<Action, { type: "send_message" } | { type: "broadcast" } | { type: "show_title" }>
  | { type: "send_message"; text: DslText }
  | { type: "broadcast"; text: DslText }
  | {
      type: "show_title";
      title: DslText;
      subtitle?: DslText;
      fadeIn?: number;
      stay?: number;
      fadeOut?: number;
    };

export interface DslIfCase {
  conditions: Condition[];
  joins?: ("and" | "or")[];
  steps: DslStep[];
}

export type DslStep =
  | { kind: "action"; action: DslAction }
  | { kind: "if"; cases: DslIfCase[]; else?: DslStep[] };
