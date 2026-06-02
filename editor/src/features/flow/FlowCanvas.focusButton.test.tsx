/**
 * FocusButton integration tests — verifies that the "Focus / Edit in full screen"
 * button appears when exactly one element is selected and navigates correctly.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FlowCanvas } from "./FlowCanvas";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type { Account, ElementId, MenuId, PackId } from "@/domain/types";

// ── Router mock ───────────────────────────────────────────────────────────────

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ workspaceId: "pack-abc" }),
}));

// ── i18n mock ─────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// ── Store mocks ───────────────────────────────────────────────────────────────

// useFlowSelectionStore is used inside FlowCanvas — stub with a no-op.
vi.mock("@/state/flowSelectionStore", () => ({
  useFlowSelectionStore: (sel: (s: { sub: null; set: () => void }) => unknown) =>
    sel({ sub: null, set: () => {} }),
}));

// useUiStore is used for activeLang — stub.
vi.mock("@/state/uiStore", () => ({
  useUiStore: (sel: (s: { activeLang: string; setDragging: () => void }) => unknown) =>
    sel({ activeLang: "en", setDragging: () => {} }),
}));

// MenuProperties renders the full title-composer tree which has heavy deps.
// Stub it to a lightweight placeholder for these integration tests.
vi.mock("@/features/canvas/properties/MenuProperties", () => ({
  MenuProperties: ({ menu }: { menu: { id: string } }) => (
    <div data-testid="menu-properties">{menu.id}</div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PACK_ID = "pack-abc" as PackId;
const MENU_ID = "menu-1" as MenuId;
const ELEMENT_ID = "elem-1" as ElementId;
const COMMAND_ID = "cmd-1";
const DIALOG_ID = "dlg-1";

function makeAccount(): Account {
  return {
    id: "acc-1" as Account["id"],
    packOrder: [PACK_ID],
    packs: [
      {
        id: PACK_ID,
        name: "Test Pack",
        source: "user_created",
        createdAt: "2026-06-01",
        updatedAt: "2026-06-01",
        defaultLang: "en",
        i18nKeys: {},
        menus: [
          {
            id: MENU_ID,
            packId: PACK_ID,
            title: [],
            rows: 3,
            layers: [
              {
                id: "layer-1" as any,
                name: "default",
                elements: [
                  {
                    id: ELEMENT_ID,
                    positions: "0",
                    appearances: [{ material: "DIAMOND", count: 1, click: [] }],
                  },
                ],
              },
            ],
            contextInputs: [],
          },
        ],
        commands: [
          {
            id: COMMAND_ID as any,
            name: "test",
            permission: null,
            description: null,
            aliases: [],
            arguments: [],
            steps: [],
          },
        ],
        dialogs: [
          {
            id: DIALOG_ID as any,
            title: { key: "dlg.title" as any },
            body: [],
            inputs: [],
            buttons: [{ id: "ok", label: { key: "dlg.ok" as any }, steps: [] }],
            canCloseWithEscape: true,
          },
        ],
        templates: [],
        assets: [],
        dataSources: [],
        importedConnectors: [],
        canvasLayout: {},
      },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function selectOne(id: string) {
  useSelectionStore.setState({ ids: new Set([id]) });
}

function selectNone() {
  useSelectionStore.setState({ ids: new Set() });
}

function selectMany(...ids: string[]) {
  useSelectionStore.setState({ ids: new Set(ids) });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FocusButton in FlowCanvas", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAccountStore.setState({ account: makeAccount() });
  });

  it("renders the Focus button when an element is selected", () => {
    selectOne(ELEMENT_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    expect(screen.getByRole("button", { name: /focusMode\.openFocus/i })).toBeInTheDocument();
  });

  it("renders the Focus button when a menu is selected", () => {
    selectOne(MENU_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    expect(screen.getByRole("button", { name: /focusMode\.openFocus/i })).toBeInTheDocument();
  });

  it("renders the Focus button when a command is selected", () => {
    selectOne(COMMAND_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    expect(screen.getByRole("button", { name: /focusMode\.openFocus/i })).toBeInTheDocument();
  });

  it("renders the Focus button when a dialog is selected", () => {
    selectOne(DIALOG_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    expect(screen.getByRole("button", { name: /focusMode\.openFocus/i })).toBeInTheDocument();
  });

  it("does NOT render the Focus button when nothing is selected", () => {
    selectNone();
    render(<FlowCanvas packId={PACK_ID} />);
    expect(screen.queryByRole("button", { name: /focusMode\.openFocus/i })).toBeNull();
  });

  it("does NOT render the Focus button when 2+ items are selected", () => {
    selectMany(ELEMENT_ID, MENU_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    expect(screen.queryByRole("button", { name: /focusMode\.openFocus/i })).toBeNull();
  });

  it("clicking the button navigates to the focus-mode route", () => {
    selectOne(ELEMENT_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /focusMode\.openFocus/i }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/workspace/$workspaceId/element/$elementId",
      params: { workspaceId: "pack-abc", elementId: ELEMENT_ID },
    });
  });

  it("clicking the button navigates using the correct elementId for a command", () => {
    selectOne(COMMAND_ID);
    render(<FlowCanvas packId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /focusMode\.openFocus/i }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/workspace/$workspaceId/element/$elementId",
      params: { workspaceId: "pack-abc", elementId: COMMAND_ID },
    });
  });
});
