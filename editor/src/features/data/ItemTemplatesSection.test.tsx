import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { I18nKey, Project, ProjectId } from "@/domain/types";
import type { ServerDataSource } from "@/lib/api/dataSources";
import { useAccountStore } from "@/state/accountStore";
import { ItemTemplatesSection } from "./ItemTemplatesSection";

const PID = "p1" as ProjectId;

const SOURCE: ServerDataSource = {
  ref: "boutique:items",
  moduleId: "boutique",
  schema: [
    { name: "id", type: "string", description: null },
    { name: "name", type: "string", description: null },
    { name: "icon", type: "string", description: null },
    { name: "category", type: "string", description: null },
    { name: "final_price", type: "integer", description: null },
  ],
  schemaHint: null,
  stability: "static",
  keyField: "id",
};

function makeProject(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      {
        id: "shop_category" as never,
        projectId: PID,
        title: [],
        rows: 6,
        contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as never }],
        layers: [
          {
            id: "l1" as never,
            name: "main",
            elements: [
              {
                id: "grid" as never,
                positions: "10-43",
                iterates: { source: "items", alias: "item" },
                appearances: [
                  {
                    material: "{item.icon}",
                    title: { key: "k_t" as I18nKey },
                    click: {
                      left: {
                        steps: [
                          { kind: "action", action: { type: "run_command", command: "boutique:buy" } as never },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { ["k_t" as I18nKey]: { en: "{item.name}" } } as Project["i18nKeys"],
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as Project;
}

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "acc" as never, projects: [makeProject()], projectOrder: [PID] },
  } as never);
});

describe("ItemTemplatesSection", () => {
  it("creates a set seeded from the element consuming the source (click carried, groupBy auto)", () => {
    render(<ItemTemplatesSection projectId={PID} source={SOURCE} />);
    fireEvent.click(screen.getByTestId("create-item-template"));

    const pack = useAccountStore.getState().account.projects[0]!;
    const tpl = pack.itemTemplates![0]!;
    expect(tpl.sourceRef).toBe("boutique:items");
    expect(tpl.alias).toBe("item"); // forced to the seed element's alias
    expect(tpl.keyField).toBe("id");
    expect(tpl.groupBy).toBe("category"); // auto-picked from the schema
    // Full-fidelity seed: appearance + click chain carried over.
    expect(tpl.appearances[0]!.material).toBe("{item.icon}");
    expect(tpl.appearances[0]!.click?.left?.steps).toHaveLength(1);
    // i18n copied onto the template's canonical key.
    const titleKey = tpl.appearances[0]!.title!.key;
    expect(titleKey).toBe(`item_templates.${tpl.id}.default.title`);
    expect(pack.i18nKeys[titleKey]).toEqual({ en: "{item.name}" });
  });

  it("lists existing sets for this source and removes on ×", () => {
    // Seed directly (the create flow opens the editor dialog, which aria-hides
    // the section behind the radix overlay).
    useAccountStore.getState().addItemTemplate({
      projectId: PID,
      template: {
        id: "tpl_x" as never,
        projectId: PID,
        name: "Vue boutique",
        sourceRef: "boutique:items",
        alias: "item",
        keyField: "id",
        appearances: [{ material: "{item.icon}", title: { key: "" as I18nKey } }],
      },
    });
    render(<ItemTemplatesSection projectId={PID} source={SOURCE} />);
    expect(screen.getByTestId("edit-template-tpl_x")).toBeTruthy();

    fireEvent.click(screen.getByTestId("remove-template-tpl_x"));
    expect(useAccountStore.getState().account.projects[0]!.itemTemplates).toHaveLength(0);
  });
});
