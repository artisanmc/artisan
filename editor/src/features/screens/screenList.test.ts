import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { fallbackScreensFor, parseFallbackScreenId, resolveScreen } from "./screenList";

const localProject = {
  id: "boutique",
  name: "Boutique",
  dataSources: [
    {
      id: "categories",
      name: "Catégories",
      shape: "table",
      modelId: "boutique:category",
      rows: [],
    },
    { id: "notes", name: "Notes", shape: "config", value: {} },
  ],
  dataModels: [
    { id: "boutique:category", name: "Category", provenance: "module", fields: [], keyField: "id" },
  ],
} as unknown as Project;

describe("fallbackScreensFor", () => {
  it("synthesizes one screen per module-declared-model table, skipping own sources", () => {
    const screens = fallbackScreensFor("boutique", ["boutique"], [localProject]);
    expect(screens).toHaveLength(1);
    expect(screens[0]).toMatchObject({
      moduleId: "boutique",
      label: "Catégories",
      table: "data/categories",
      projectId: "boutique",
    });
    expect(parseFallbackScreenId(screens[0]!.id)).toEqual({
      moduleId: "boutique",
      projectId: "boutique",
      sourceId: "categories",
    });
  });

  it("returns nothing when the project is not loaded locally", () => {
    expect(fallbackScreensFor("boutique", ["boutique"], [])).toEqual([]);
  });
});

describe("resolveScreen", () => {
  const declared = [
    {
      id: "boutique:catalog",
      moduleId: "boutique",
      label: "Catalogue",
      table: "data/categories",
      projectId: "boutique",
    },
  ];

  it("prefers a declared screen", () => {
    expect(resolveScreen("boutique:catalog", declared, [localProject])?.label).toBe("Catalogue");
  });

  it("resolves a fallback id from the local project", () => {
    const s = resolveScreen("boutique:__auto__boutique__categories", [], [localProject]);
    expect(s).toMatchObject({
      label: "Catégories",
      table: "data/categories",
      projectId: "boutique",
    });
  });

  it("returns null for an unknown non-fallback id", () => {
    expect(resolveScreen("ghost:screen", [], [localProject])).toBeNull();
  });
});
