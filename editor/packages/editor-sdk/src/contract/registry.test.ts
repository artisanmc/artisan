import { describe, expect, it, beforeEach } from "vitest";
import {
  registerModule,
  listModules,
  clearRegistry,
  getModule,
  collectModuleExportFiles,
} from "./registry";
import type { FrontendModule } from "./types";

describe("frontend module registry", () => {
  beforeEach(() => clearRegistry());

  const stub = (id: string): FrontendModule => ({
    id,
    displayName: id,
    schemaVersion: `${id}/v1`,
    sidebar: { icon: () => null, label: id, to: `/${id}` },
    routes: [],
  });

  it("registers modules in order", () => {
    registerModule(stub("menus"));
    registerModule(stub("commands"));
    expect(listModules().map((m) => m.id)).toEqual(["menus", "commands"]);
  });

  it("getModule returns by id", () => {
    registerModule(stub("menus"));
    expect(getModule("menus")?.id).toBe("menus");
    expect(getModule("ghost")).toBeUndefined();
  });

  it("throws on duplicate id", () => {
    registerModule(stub("a"));
    expect(() => registerModule(stub("a"))).toThrow(/duplicate/i);
  });
});

describe("collectModuleExportFiles", () => {
  beforeEach(() => clearRegistry());

  it("collects namespaced files from registered modules and drops out-of-namespace keys", () => {
    registerModule({
      id: "boutique",
      displayName: "Boutique",
      schemaVersion: "shop/v1",
      sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
      routes: [],
      exportFiles: () => ({
        "boutique/items.yaml": "items: []",
        "menus/hijack.yaml": "nope", // outside the namespace: ignored
      }),
    });
    expect(collectModuleExportFiles({})).toEqual({ "boutique/items.yaml": "items: []" });
  });

  it("returns {} when no module contributes files", () => {
    expect(collectModuleExportFiles({})).toEqual({});
  });
});
