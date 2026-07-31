import { describe, expect, it } from "vitest";
import { AstCache } from "./cache";

describe("AstCache", () => {
  it("parses an expression and caches the AST", () => {
    const cache = new AstCache(10);
    const a = cache.get("p1", 1, "x + 1");
    const b = cache.get("p1", 1, "x + 1");
    expect(a).toBe(b);
  });

  it("re-parses on different version", () => {
    const cache = new AstCache(10);
    const a = cache.get("p1", 1, "x + 1");
    const b = cache.get("p1", 2, "x + 1");
    expect(a).not.toBe(b);
  });

  it("re-parses on different project id", () => {
    const cache = new AstCache(10);
    const a = cache.get("p1", 1, "x + 1");
    const b = cache.get("p2", 1, "x + 1");
    expect(a).not.toBe(b);
  });

  it("evicts oldest when at capacity", () => {
    const cache = new AstCache(2);
    cache.get("p1", 1, "a");
    cache.get("p1", 1, "b");
    cache.get("p1", 1, "c"); // evicts "a"
    expect(cache.size).toBe(2);
  });

  it("re-parsing an evicted key produces a new AST", () => {
    const cache = new AstCache(2);
    const a = cache.get("p1", 1, "a");
    cache.get("p1", 1, "b");
    cache.get("p1", 1, "c"); // evicts "a"
    const a2 = cache.get("p1", 1, "a");
    expect(a2).not.toBe(a);
  });
});
