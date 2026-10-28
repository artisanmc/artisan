/**
 * Regression: typing in a state card's title field must reach the store.
 * An edit of "§7Retour" → "<gray>Retour" in the edit panel never left the
 * UI. This mounts the real ElementEditor path (SelectionInspector) for a plain
 * element and asserts the store write.
 */
import "@/i18n";
import { menusOf } from "@/domain/documents";
import type {
  DataSourceId,
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

const PACK_ID = "p_edit" as ProjectId;
const MENU_ID = "shop_category" as MenuId;
const ELEMENT_ID = "back" as ElementId;
const KEY = "lt_back_title" as I18nKey;

function makeProject(): Project {
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
                  display: { material: "ARROW", title: { key: KEY } },
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

/** Replaces the whole text of the dialog's MiniMessage editor that holds `current`. */
function replaceEditorText(current: string, next: string) {
  const content = [...within(screen.getByRole("dialog")).getAllByRole("textbox")].find(
    (node) => node.classList.contains("cm-content") && node.textContent === current,
  )!;
  const view = EditorView.findFromDOM(content)!;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
}

describe("state card title editing reaches the store", () => {
  it("selects a typed item field and stores an explicit binding", () => {
    const project = makeProject();
    project.dataSources = [
      {
        id: "settings" as DataSourceId,
        name: "settings",
        shape: "config",
        fields: [{ name: "icon", type: { kind: "item" } }],
        value: { icon: { material: "DIAMOND", count: 4 } },
      },
    ] as Project["dataSources"];
    menusOf(project)[0]!.contextInputs = [
      { kind: "sourceRef", name: "catalog", ref: "pack:settings" },
    ] as NonNullable<Menu["contextInputs"]>;
    useProjectsStore.setState({
      openProjects: { projects: [project], projectOrder: [PACK_ID] } as OpenProjects,
    });
    render(<SelectionInspector projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    fireEvent.click(screen.getByRole("button", { name: /^(icon|icône)$/i }));
    fireEvent.click(screen.getByRole("button", { name: "catalog.icon" }));
    const appearance = () =>
      menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!.layers[0]!.elements[0]!
        .display!;
    expect(appearance()).toMatchObject({ item: "{catalog.icon}" });
    expect(appearance().material).toBeUndefined();
    const count = screen.getByRole("spinbutton", { name: /count|quantité/i });
    expect(count).toHaveAttribute("placeholder", "4");
    fireEvent.change(count, { target: { value: "2" } });
    expect(appearance().count).toBe(2);
    fireEvent.click(
      screen.getByRole("button", { name: /(?:restore inherited|revenir à la valeur).*\(count\)/i }),
    );
    expect(appearance().count).toBeUndefined();
  });
  it("clears the template count to inherit the catalog icon quantity", () => {
    render(<SelectionInspector projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    const input = screen.getByRole("spinbutton", { name: /count|quantité/i });
    fireEvent.change(input, { target: { value: "8" } });
    expect(
      menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!.layers[0]!.elements[0]!
        .display!.count,
    ).toBe(8);
    fireEvent.change(input, { target: { value: "" } });
    expect(
      menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!.layers[0]!.elements[0]!
        .display!.count,
    ).toBeUndefined();
    fireEvent.change(input, { target: { value: "1" } });
    expect(
      menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!.layers[0]!.elements[0]!
        .display!.count,
    ).toBe(1);
  });
  beforeEach(() => {
    const openProjects: OpenProjects = {
      projects: [makeProject()],
      projectOrder: [PACK_ID],
    } as unknown as OpenProjects;
    useProjectsStore.setState({ openProjects });
    useSelectionStore.getState().set([ELEMENT_ID], null, MENU_ID);
  });

  it.each(["{cat.icon}", "{item.icon}", "nexo:MySword", "item:my_icon"])(
    "preserves material reference %s when entered in the editor",
    (material) => {
      render(<SelectionInspector projectId={PACK_ID} />);
      fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
      fireEvent.change(screen.getByDisplayValue("ARROW"), { target: { value: material } });
      const project = useProjectsStore.getState().openProjects.projects[0]!;
      expect(menusOf(project)[0]!.layers[0]!.elements[0]!.display!.material).toBe(material);
      expect(screen.getByDisplayValue(material)).toBeTruthy();
    },
  );

  it("typing writes the ACTIVE language (fallback text shown ≠ language written)", () => {
    useUiStore.setState({ activeLang: "en" });
    render(<SelectionInspector projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    replaceEditorText("§7Retour", "<gray>Retour");

    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PACK_ID)!;
    const el = menusOf(project)[0]!.layers[0]!.elements[0]!;
    // The displayed "§7Retour" was the fr FALLBACK; typing writes en. This is
    // by design (the label says which language) — fr stays untouched.
    expect(project.i18nKeys[el.display!.title!.key]).toEqual({
      fr: "§7Retour",
      en: "<gray>Retour",
    });
  });

  it("typing with the default language active edits it directly", () => {
    useUiStore.setState({ activeLang: "fr" });
    render(<SelectionInspector projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    replaceEditorText("§7Retour", "<gray>Retour");
    const project = useProjectsStore
      .getState()
      .openProjects.projects.find((p) => p.id === PACK_ID)!;
    const el = menusOf(project)[0]!.layers[0]!.elements[0]!;
    expect(project.i18nKeys[el.display!.title!.key]).toEqual({ fr: "<gray>Retour" });
  });

  it("shows the fallback variant of the title label when the active lang has no value", () => {
    useUiStore.setState({ activeLang: "en" });
    render(<SelectionInspector projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    // The label must warn that the shown text is the fr fallback, not en.
    expect(screen.getByText(/fallback/i)).toBeTruthy();
  });
});
