/**
 * Regression: typing in a state card's title field must reach the store.
 * An edit of "§7Retour" → "<gray>Retour" in the edit panel never left the
 * UI. This mounts the real ElementEditor path (FlowCanvas) for a plain
 * element and asserts the store write.
 */
import "@/i18n";
import type { Account, ElementId, I18nKey, Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { menusOf } from "@/domain/documents";

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

describe("state card title editing reaches the store", () => {
  it("selects a typed item field and stores an explicit binding", () => {
    const project = makeProject();
    project.dataSources = [
      {
        id: "settings",
        name: "settings",
        shape: "config",
        fields: [{ name: "icon", type: { kind: "item" } }],
        value: { icon: { material: "DIAMOND", count: 4 } },
      },
    ] as Project["dataSources"];
    menusOf(project)[0]!.contextInputs = [
      { kind: "sourceRef", name: "catalog", ref: "pack:settings" },
    ] as NonNullable<Menu["contextInputs"]>;
    useAccountStore.setState({
      account: { projects: [project], projectOrder: [PACK_ID] } as Account,
    });
    render(<FlowCanvas projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    fireEvent.click(screen.getByRole("button", { name: /^(icon|icône)$/i }));
    fireEvent.click(screen.getByRole("button", { name: "catalog.icon" }));
    const appearance = () =>
      menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!.elements[0]!.display!;
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
    render(<FlowCanvas projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    const input = screen.getByRole("spinbutton", { name: /count|quantité/i });
    fireEvent.change(input, { target: { value: "8" } });
    expect(
      menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!.elements[0]!.display!
        .count,
    ).toBe(8);
    fireEvent.change(input, { target: { value: "" } });
    expect(
      menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!.elements[0]!.display!
        .count,
    ).toBeUndefined();
    fireEvent.change(input, { target: { value: "1" } });
    expect(
      menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!.elements[0]!.display!
        .count,
    ).toBe(1);
  });
  beforeEach(() => {
    const account: Account = {
      projects: [makeProject()],
      projectOrder: [PACK_ID],
    } as unknown as Account;
    useAccountStore.setState({ account });
    useSelectionStore.getState().set([ELEMENT_ID], null, MENU_ID);
  });

  it.each(["{cat.icon}", "{item.icon}", "nexo:MySword", "item:my_icon"])(
    "preserves material reference %s when entered in the editor",
    (material) => {
      render(<FlowCanvas projectId={PACK_ID} />);
      fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
      fireEvent.change(screen.getByDisplayValue("ARROW"), { target: { value: material } });
      const project = useAccountStore.getState().account.projects[0]!;
      expect(menusOf(project)[0]!.layers[0]!.elements[0]!.display!.material).toBe(material);
      expect(screen.getByDisplayValue(material)).toBeTruthy();
    },
  );

  it("typing writes the ACTIVE language (fallback text shown ≠ language written)", () => {
    useUiStore.setState({ activeLang: "en" });
    render(<FlowCanvas projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    // The title field renders as a facade button first — activate it (the
    // element header shows the same text; only the RevealField facade is a
    // button, so click the button occurrence).
    const facade = within(screen.getByRole("dialog"))
      .getAllByText("§7Retour")
      .map((n) => n.closest("button"))
      .find((b) => b !== null)!;
    fireEvent.click(facade);
    const input = screen.getByDisplayValue("§7Retour");
    fireEvent.change(input, { target: { value: "<gray>Retour" } });

    const project = useAccountStore.getState().account.projects.find((p) => p.id === PACK_ID)!;
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
    render(<FlowCanvas projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    const facade = within(screen.getByRole("dialog"))
      .getAllByText("§7Retour")
      .map((n) => n.closest("button"))
      .find((b) => b !== null)!;
    fireEvent.click(facade);
    fireEvent.change(screen.getByDisplayValue("§7Retour"), {
      target: { value: "<gray>Retour" },
    });
    const project = useAccountStore.getState().account.projects.find((p) => p.id === PACK_ID)!;
    const el = menusOf(project)[0]!.layers[0]!.elements[0]!;
    expect(project.i18nKeys[el.display!.title!.key]).toEqual({ fr: "<gray>Retour" });
  });

  it("shows the fallback variant of the title label when the active lang has no value", () => {
    useUiStore.setState({ activeLang: "en" });
    render(<FlowCanvas projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /modifier l.item|edit item/i }));
    // The label must warn that the shown text is the fr fallback, not en.
    expect(screen.getByText(/fallback/i)).toBeTruthy();
  });
});
