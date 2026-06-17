import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = new Map<string, unknown>();
vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) => registered.get(id),
}));

import { resolveModule } from "./resolveModule";

const Screen = () => null;

beforeEach(() => registered.clear());

describe("resolveModule", () => {
  it("returns the module's component when registered with a route", () => {
    registered.set("quests", { id: "quests", routes: [{ path: "/", component: Screen }] });
    expect(resolveModule("quests", "ready")).toEqual({ kind: "component", component: Screen });
  });

  it("returns loading when the module is absent and integration is in flight", () => {
    expect(resolveModule("quests", "loading")).toEqual({ kind: "loading" });
  });

  it("returns missing when absent and integration settled", () => {
    expect(resolveModule("quests", "ready")).toEqual({ kind: "missing" });
  });

  it("returns missing when the module has no routes", () => {
    registered.set("quests", { id: "quests", routes: [] });
    expect(resolveModule("quests", "ready")).toEqual({ kind: "missing" });
  });

  it("returns loading when the module is absent and status is idle", () => {
    expect(resolveModule("quests", "idle")).toEqual({ kind: "loading" });
  });
});
