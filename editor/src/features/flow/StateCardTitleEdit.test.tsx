/**
 * Regression: typing in a state card's title field must reach the store.
 * The user edited "§7Retour" → "<gray>Retour" in the edit panel, deployed
 * three times — and the three commits carried an IDENTICAL editor_json:
 * the edit never left the UI. This mounts the real ElementEditor path
 * (FlowCanvas) for a plain element and asserts the store write.
 */
import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type { Account, ElementId, I18nKey, MenuId, Project, ProjectId } from "@/domain/types";

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
    menus: [
      {
        id: MENU_ID,
        projectId: PACK_ID,
        title: [],
        rows: 6,
        layers: [
          {
            id: "l1" as Project["menus"][number]["layers"][number]["id"],
            name: "default",
            elements: [
              {
                id: ELEMENT_ID,
                positions: "49",
                appearances: [{ material: "ARROW", title: { key: KEY } }],
              },
            ],
          },
        ],
      },
    ],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { [KEY]: { fr: "§7Retour" } },
    defaultLang: "fr",
    dialogs: [],
    canvasLayout: {},
  };
}

describe("state card title editing reaches the store", () => {
  beforeEach(() => {
    const account: Account = {
      projects: [makeProject()],
      projectOrder: [PACK_ID],
    } as unknown as Account;
    useAccountStore.setState({ account });
    useSelectionStore.getState().set([ELEMENT_ID], null, MENU_ID);
  });

  it("typing writes the ACTIVE language (fallback text shown ≠ language written)", () => {
    useUiStore.setState({ activeLang: "en" });
    render(<FlowCanvas projectId={PACK_ID} />);
    // The title field renders as a facade button first — activate it (the
    // element header shows the same text; only the RevealField facade is a
    // button, so click the button occurrence).
    const facade = screen
      .getAllByText("§7Retour")
      .map((n) => n.closest("button"))
      .find((b) => b !== null)!;
    fireEvent.click(facade);
    const input = screen.getByDisplayValue("§7Retour");
    fireEvent.change(input, { target: { value: "<gray>Retour" } });

    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PACK_ID)!;
    const el = pack.menus[0]!.layers[0]!.elements[0]!;
    // The displayed "§7Retour" was the fr FALLBACK; typing writes en. This is
    // by design (the label says which language) — fr stays untouched.
    expect(pack.i18nKeys[el.appearances[0]!.title!.key]).toEqual({
      fr: "§7Retour",
      en: "<gray>Retour",
    });
  });

  it("typing with the default language active edits it directly", () => {
    useUiStore.setState({ activeLang: "fr" });
    render(<FlowCanvas projectId={PACK_ID} />);
    const facade = screen
      .getAllByText("§7Retour")
      .map((n) => n.closest("button"))
      .find((b) => b !== null)!;
    fireEvent.click(facade);
    fireEvent.change(screen.getByDisplayValue("§7Retour"), {
      target: { value: "<gray>Retour" },
    });
    const pack = useAccountStore.getState().account.projects.find((p) => p.id === PACK_ID)!;
    const el = pack.menus[0]!.layers[0]!.elements[0]!;
    expect(pack.i18nKeys[el.appearances[0]!.title!.key]).toEqual({ fr: "<gray>Retour" });
  });

  it("shows the fallback variant of the title label when the active lang has no value", () => {
    useUiStore.setState({ activeLang: "en" });
    render(<FlowCanvas projectId={PACK_ID} />);
    // The label must warn that the shown text is the fr fallback, not en.
    expect(screen.getByText(/fallback/i)).toBeTruthy();
  });
});
