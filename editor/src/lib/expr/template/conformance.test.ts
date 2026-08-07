import { describe, expect, it } from "vitest";
// Shared cross-stack conformance vector (mirrored by the Kotlin
// `TemplateConformanceTest`). Proves the editor's preview and the server render
// a Template to the exact same string — ADR `expression-parity` §1.
import fixtures from "../../../../../testdata/template-conformance.json";
import { AstCache } from "../cache";
import { Scope } from "../scope";
import { renderTemplate } from "./renderer";

interface TemplateFixture {
  name: string;
  template: string;
  scope: Record<string, unknown>;
  papi?: Record<string, string>;
  lang?: Record<string, string>;
  /** Fixed clock so `until()` is deterministic. */
  now?: number;
  /** Exact expected output. Mutually exclusive with `expectedPrefix`. */
  expected?: string;
  /** For malformed input, where the ⚠️ message text is implementation detail. */
  expectedPrefix?: string;
}

describe("template conformance", () => {
  for (const fx of fixtures as TemplateFixture[]) {
    it(fx.name, () => {
      const papi = fx.papi ?? {};
      const lang = fx.lang ?? {};
      const out = renderTemplate(fx.template, {
        scope: new Scope(fx.scope, {
          papi: (name) => papi[name] ?? "",
          now: () => fx.now ?? 0,
          // Presentation keys live in the project's translations, like any other.
          translate: (key) => lang[key],
        }),
        cache: new AstCache(64),
        projectId: "conformance",
        projectVersion: 1,
        i18nLookup: (key) => lang[key],
      });

      if (fx.expectedPrefix !== undefined) {
        expect(out.startsWith(fx.expectedPrefix), `got: ${out}`).toBe(true);
      } else {
        expect(out).toBe(fx.expected);
      }
    });
  }
});
