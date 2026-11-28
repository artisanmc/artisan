/**
 * An item's look and an image button's look offer what each one draws: a component
 * only on an image button, and the image button's name and lore in the item's dialog
 * (rich editors, in-game preview) without the item-only fields.
 */
import "@/i18n";
import { menusOf } from "@/domain/documents";
import type {
  ElementId,
  I18nKey,
  Menu,
  MenuId,
  OpenProjects,
  Project,
  ProjectId,
} from "@/domain/types";
import { SelectionInspector } from "@/features/inspector/SelectionInspector";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

const PACK_ID = "p_look" as ProjectId;
const MENU_ID = "shop_category" as MenuId;
const ELEMENT_ID = "back" as ElementId;
const KEY = "lt_back_title" as I18nKey;

function makeProject(display: Record<string, unknown>): Project {
  return {
    id: PACK_ID,
    name: "edit",
    source: "user_created",
    createdAt: "2026-07-19",
    updatedAt: "2026-07-19",
    documents: {
      menu: [
        {
          id: MENU_ID,
          projectId: PACK_ID,
          title: [],
          rows: 6,
          layers: [
            {
              id: "l1" as Menu["layers"][number]["id"],
              name: "default",
              elements: [
                {
                  id: ELEMENT_ID,
                  positions: "49",
                  display: {
                    ...display,
                    title: { key: KEY },
                  } as Menu["layers"][number]["elements"][number]["display"],
                  states: [],
                },
              ],
            },
          ],
        },
      ],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { [KEY]: { fr: "§7Retour" } },
    defaultLang: "fr",
    canvasLayout: {},
  };
}

function open(display: Record<string, unknown>, moduleData?: unknown) {
  useProjectsStore.setState({
    openProjects: {
      projects: [{ ...makeProject(display), moduleData }],
      projectOrder: [PACK_ID],
    } as unknown as OpenProjects,
  });
  useSelectionStore.getState().set([ELEMENT_ID], null, MENU_ID);
  render(<SelectionInspector projectId={PACK_ID} />);
}

const IMAGE = { image: { asset: "btn", fit: "native" } };

describe("an element's look", () => {
  beforeEach(() => useUiStore.setState({ activeLang: "fr" }));

  it("offers no component on an item", () => {
    open({ material: "ARROW" });
    expect(screen.queryByText(/utiliser un composant|use a component/i)).toBeNull();
  });

  it("offers a component on an image button", () => {
    open(IMAGE, { components: { __files: { "confirm.yml": "parts:\n  - image: btn\n" } } });
    expect(screen.getAllByText(/utiliser un composant|use a component/i).length).toBeGreaterThan(0);
  });

  it("edits an image button's name in the item dialog, without the item's count", () => {
    open(IMAGE);
    fireEvent.click(screen.getByRole("button", { name: /modifier le nom et la description/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("spinbutton")).toBeNull();
    const content = [...within(dialog).getAllByRole("textbox")].find(
      (node) => node.classList.contains("cm-content") && node.textContent === "§7Retour",
    )!;
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<gold>Valider" } });
    const project = useProjectsStore.getState().openProjects.projects[0]!;
    const el = menusOf(project)[0]!.layers[0]!.elements[0]!;
    expect(project.i18nKeys[el.display!.title!.key]).toEqual({ fr: "<gold>Valider" });
    expect(el.display!.image).toEqual(IMAGE.image);
  });
});
