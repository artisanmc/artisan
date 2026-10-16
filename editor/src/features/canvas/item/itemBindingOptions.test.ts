import type { Element, Menu, Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { itemBindingOptions } from "./itemBindingOptions";

describe("item data bindings", () => {
  it("uses a declared module row model without a live server schema", () => {
    const project = {
      dataModels: [{ id: "boutique:item", fields: [{ name: "icon", type: { kind: "item" } }] }],
      dataSources: [],
    } as unknown as Project;
    const menu = {
      contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" }],
    } as Menu;
    expect(
      itemBindingOptions(
        project,
        menu,
        { iterates: { source: "items", alias: "item" } } as Element,
        [],
        { "boutique:items": "boutique:item" },
      ),
    ).toEqual(["item.icon"]);
  });
  it("uses ITEM fields reported by a server source", () => {
    const menu = {
      contextInputs: [{ kind: "sourceRef", name: "products", ref: "boutique:items" }],
    } as Menu;
    const element = { iterates: { source: "products", alias: "item" } } as Element;
    expect(
      itemBindingOptions({ dataModels: [], dataSources: [] } as unknown as Project, menu, element, [
        {
          ref: "boutique:items",
          moduleId: "boutique",
          schemaHint: null,
          schema: [
            { name: "icon", type: "item", description: null },
            { name: "name", type: "string", description: null },
          ],
        },
      ]),
    ).toEqual(["item.icon"]);
  });
  const project = {
    ownerModule: "boutique",
    dataModels: [
      {
        id: "category",
        fields: [
          { name: "icon", type: { kind: "item" } },
          { name: "name", type: { kind: "string" } },
          {
            name: "items",
            type: {
              kind: "list",
              of: { kind: "object", fields: [{ name: "icon", type: { kind: "item" } }] },
            },
          },
        ],
      },
    ],
    dataSources: [
      { id: "categories", name: "categories", shape: "table", modelId: "category", rows: [] },
    ],
  } as unknown as Project;
  it("offers only item fields on a category and its current product", () => {
    const menu = {
      contextInputs: [
        { kind: "primitive", name: "cat", type: "object", rowOf: "boutique:categories" },
      ],
    } as Menu;
    const element = { iterates: { source: "cat.items", alias: "item" } } as Element;
    expect(itemBindingOptions(project, menu, element)).toEqual(["cat.icon", "item.icon"]);
  });
  it("binds placement aliases while leaving unbound list fields out", () => {
    const menu = {
      contextInputs: [{ kind: "sourceRef", name: "categories", ref: "boutique:categories" }],
    } as Menu;
    expect(itemBindingOptions(project, menu, {} as Element)).toEqual([]);
    expect(
      itemBindingOptions(project, menu, {
        places: { source: "categories", alias: "cat" },
      } as Element),
    ).toEqual(["cat.icon"]);
  });
});
