import { describe, expect, it } from "vitest";
import { AstCache } from "../cache";
import { Scope } from "../scope";
import { renderTemplate } from "./renderer";

const noopCache = new AstCache(100);
const noI18n = (_: string) => undefined;

describe("renderTemplate", () => {
  it("returns plain text unchanged", () => {
    expect(
      renderTemplate("hello", {
        scope: new Scope({}),
        cache: noopCache,
        projectId: "p1",
        projectVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("hello");
  });

  it("substitutes a simple placeholder", () => {
    expect(
      renderTemplate("Hi {name}!", {
        scope: new Scope({ name: "Steve" }),
        cache: noopCache,
        projectId: "p1",
        projectVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("Hi Steve!");
  });

  it("evaluates a complex expression", () => {
    expect(
      renderTemplate(`Tags: {xs.join(", ")}`, {
        scope: new Scope({ xs: ["a", "b", "c"] }),
        cache: noopCache,
        projectId: "p1",
        projectVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("Tags: a, b, c");
  });

  it("evaluates a ternary inside a template", () => {
    expect(
      renderTemplate(`{x > 5 ? "big" : "small"}`, {
        scope: new Scope({ x: 10 }),
        cache: noopCache,
        projectId: "p1",
        projectVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("big");
  });

  it("resolves i18n then expressions", () => {
    expect(
      renderTemplate("X {i18n:greeting} {name}", {
        scope: new Scope({ name: "Steve" }),
        cache: noopCache,
        projectId: "p1",
        projectVersion: 1,
        i18nLookup: (k) => (k === "greeting" ? "Hello" : undefined),
      }),
    ).toBe("X Hello Steve");
  });

  it("inserts a warn marker for invalid expression", () => {
    const out = renderTemplate("{ invalid !! syntax }", {
      scope: new Scope({}),
      cache: noopCache,
      projectId: "p1",
      projectVersion: 1,
      i18nLookup: noI18n,
    });
    expect(out).toContain("⚠️");
  });

  it("returns empty for null arithmetic (string - number)", () => {
    const out = renderTemplate(`{"hi" - 1}`, {
      scope: new Scope({}),
      cache: noopCache,
      projectId: "p1",
      projectVersion: 1,
      i18nLookup: noI18n,
    });
    // string - number → null, toStringValue(null) = ""
    expect(out).toBe("");
  });

  it("resolves PAPI tokens both inside and outside expressions", () => {
    expect(
      renderTemplate(`Solde: %eco% / Bonus: {%eco% > 100 ? "OK" : "low"}`, {
        scope: new Scope({}, { papi: (k) => (k === "eco" ? "150" : "") }),
        cache: noopCache,
        projectId: "p1",
        projectVersion: 1,
        i18nLookup: noI18n,
      }),
    ).toBe("Solde: 150 / Bonus: OK");
  });
});
