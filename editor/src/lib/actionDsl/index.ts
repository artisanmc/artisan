/**
 * Action DSL codec — the pure, Project-free text serialization of an Action
 * chain (`Step[]`). Cf. ADR `action-dsl`. `parseActionDsl` / `printActionDsl`
 * round-trip through the {@link DslStep} AST; a separate editor adapter maps
 * `DslStep[]` ↔ domain `Step[]` (i18n key minting). The shared conformance
 * fixtures lock this against the eventual Kotlin implementation.
 */

export type { DslStep, DslAction, DslIfCase, DslText } from "./ast";
export { parseActionDsl } from "./parser";
export { printActionDsl } from "./printer";
export { dslStepsToSteps, parseToSteps, type TextToLText, type LTextToText } from "./domainSteps";
