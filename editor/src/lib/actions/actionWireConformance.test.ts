import type { I18nKey, LText, Step } from "@/domain/types";
import { describe, expect, it } from "vitest";
import vector from "../../../../testdata/action-wire-conformance.json";
import {
  type ActionTextCodec,
  type FieldText,
  stepsToStructured,
  structuredToSteps,
} from "./structuredSteps";

/**
 * `testdata/action-wire-conformance.json` pins the structured action wire (ADR
 * `structured-action-wire`) across the two stacks. The plugin
 * (`ActionWireConformanceTest`) reads the same vector: what the editor writes is
 * what the game runs, and a hand-written variant reads as the same chain.
 *
 * Editor side: canonicalize(wire) == canonical, canonicalize is idempotent, and
 * the top-level step names match. Text goes through an identity codec so the
 * wire's own text shape (string or language map) is what comes back.
 */
const texts = new Map<string, FieldText>();
let counter = 0;
const codec: ActionTextCodec = {
  toWire: (key) => texts.get(key) ?? "",
  fromWire: (raw) => {
    const key = `wire_${counter++}` as I18nKey;
    texts.set(key, raw);
    return { key } as LText;
  },
};

const canonicalize = (wire: unknown) => stepsToStructured(structuredToSteps(wire, codec), codec);

/** The wire name of each top-level step: an action's key, or `if`. */
const names = (steps: Step[]): string[] =>
  steps.map((s) => (s.kind === "if" ? "if" : s.action.name));

describe("action wire — shared vector with the plugin", () => {
  for (const c of vector.cases) {
    it(c.name, () => {
      expect(canonicalize(c.wire)).toEqual(c.canonical);
      expect(canonicalize(c.canonical)).toEqual(c.canonical);
      expect(names(structuredToSteps(c.wire, codec))).toEqual(c.names);
    });
  }
});
