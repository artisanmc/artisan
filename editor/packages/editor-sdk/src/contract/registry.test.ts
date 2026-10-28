import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRegistry,
  collectModuleExportFiles,
  documentKindContribution,
  getModule,
  listDocumentKindContributions,
  listModules,
  registerModule,
} from "./registry";
import type { DocumentKindContribution, FrontendModule } from "./types";

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

describe("document kind contributions", () => {
  beforeEach(() => clearRegistry());

  const kind = (name: string): DocumentKindContribution => ({
    kind: name,
    dir: `${name}s`,
    schemaVersion: `${name}/v1`,
    label: name,
    component: () => null,
    create: ({ id }) => ({ id }),
    parse: (src) => ({ doc: src, i18nKeys: {}, unsupported: [] }),
    serialize: () => ({}),
  });
  const mod = (id: string, ...documents: DocumentKindContribution[]): FrontendModule => ({
    id,
    displayName: id,
    schemaVersion: `${id}/v1`,
    sidebar: { icon: () => null, label: id, to: `/${id}` },
    routes: [],
    documents,
  });

  it("lists every contributed kind in registration order and finds one by kind", () => {
    registerModule(mod("quests", kind("quest")));
    registerModule(mod("shop", kind("product"), kind("offer")));
    expect(listDocumentKindContributions().map((c) => c.kind)).toEqual([
      "quest",
      "product",
      "offer",
    ]);
    expect(documentKindContribution("offer")?.dir).toBe("offers");
    expect(documentKindContribution("ghost")).toBeUndefined();
  });

  it("refuses a kind two modules contribute", () => {
    registerModule(mod("quests", kind("quest")));
    expect(() => registerModule(mod("other", kind("quest")))).toThrow(/already contributed/);
    expect(getModule("other")).toBeUndefined();
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
