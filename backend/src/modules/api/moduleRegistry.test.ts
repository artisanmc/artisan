import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { mountModules } from "./moduleRegistry";
import type { BackendModule } from "./types";

describe("mountModules", () => {
  it("calls registerRoutes on each module", () => {
    const calls: string[] = [];
    const modA: BackendModule = {
      id: "a",
      schemaVersion: "a/v1",
      registerRoutes: () => calls.push("a"),
    };
    const modB: BackendModule = {
      id: "b",
      schemaVersion: "b/v1",
      registerRoutes: () => calls.push("b"),
    };

    mountModules(new Hono(), [modA, modB]);

    expect(calls).toEqual(["a", "b"]);
  });

  it("throws on duplicate module id", () => {
    const mod: BackendModule = {
      id: "dup",
      schemaVersion: "dup/v1",
      registerRoutes: () => {},
    };
    expect(() => mountModules(new Hono(), [mod, mod])).toThrow(/duplicate/i);
  });

  it("exposes the list of registered ids via the returned handle", () => {
    const mod: BackendModule = {
      id: "x",
      schemaVersion: "x/v1",
      registerRoutes: () => {},
    };
    const handle = mountModules(new Hono(), [mod]);
    expect(handle.ids()).toEqual(["x"]);
  });
});
