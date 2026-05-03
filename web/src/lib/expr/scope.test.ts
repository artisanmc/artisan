import { describe, expect, it } from "vitest";
import { Scope } from "./scope";

describe("Scope", () => {
  it("looks up an identifier from the bag", () => {
    const s = new Scope({ category: "weapons" });
    expect(s.lookup("category")).toBe("weapons");
  });

  it("returns undefined for unknown identifier", () => {
    const s = new Scope({});
    expect(s.lookup("missing")).toBeUndefined();
  });

  it("invokes the papi resolver", () => {
    const s = new Scope({}, { papi: (k) => (k === "player_name" ? "Steve" : "") });
    expect(s.papi("player_name")).toBe("Steve");
  });

  it("returns empty string when no papi resolver is provided", () => {
    const s = new Scope({});
    expect(s.papi("player_name")).toBe("");
  });

  it("child scope inherits parent identifiers", () => {
    const parent = new Scope({ a: 1 });
    const child = parent.child({ b: 2 });
    expect(child.lookup("a")).toBe(1);
    expect(child.lookup("b")).toBe(2);
  });

  it("child scope shadows parent on conflict", () => {
    const parent = new Scope({ a: 1 });
    const child = parent.child({ a: 99 });
    expect(child.lookup("a")).toBe(99);
  });

  it("child inherits the parent papi resolver if not overridden", () => {
    const parent = new Scope({}, { papi: (k) => `P:${k}` });
    const child = parent.child({});
    expect(child.papi("x")).toBe("P:x");
  });
});
