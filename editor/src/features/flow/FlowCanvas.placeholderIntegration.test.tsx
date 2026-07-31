/**
 * Integration smoke test: catalog → hook → PlaceholderInput.
 *
 * Mounts a thin wrapper that wires usePlaceholderEntries → PlaceholderInput
 * with a real-shaped project seeded in the accountStore. Validates that a
 * primitive contextInput named "player" survives the full pipeline and
 * surfaces in the autocomplete popup when the user types "{".
 */
import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { PlaceholderInput } from "@/components/PlaceholderInput";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import type { FieldLocation } from "@/lib/placeholderCatalog";
import { useAccountStore } from "@/state/accountStore";
import type { Account, ElementId, MenuId, Project, ProjectId } from "@/domain/types";

// ── Minimal project fixture ──────────────────────────────────────────────────────

const PACK_ID = "p_smoke" as ProjectId;
const MENU_ID = "m_smoke" as MenuId;
const ELEMENT_ID = "e_smoke" as ElementId;

function makeProject(): Project {
  return {
    id: PACK_ID,
    name: "smoke",
    source: "user_created",
    createdAt: "2026-05-31",
    updatedAt: "2026-05-31",
    menus: [
      {
        id: MENU_ID,
        projectId: PACK_ID,
        title: [],
        rows: 3,
        layers: [
          {
            id: "l1" as Project["menus"][number]["layers"][number]["id"],
            name: "default",
            elements: [
              { id: ELEMENT_ID, positions: "0", appearances: [] },
            ],
          },
        ],
        contextInputs: [
          { kind: "primitive", name: "player", type: "player", default: "Steve" },
        ],
      },
    ],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };
}

// ── Thin wrapper component ────────────────────────────────────────────────────

function TitleInput({ location }: { location: FieldLocation }) {
  const entries = usePlaceholderEntries(PACK_ID, location);
  return (
    <PlaceholderInput
      value=""
      onChange={() => {}}
      entries={entries}
    />
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("placeholder catalog → hook → PlaceholderInput integration", () => {
  beforeEach(() => {
    const account: Account = {
      id: "acc_smoke" as Account["id"],
      projects: [makeProject()],
      projectOrder: [PACK_ID],
    };
    useAccountStore.setState({ account });
  });

  it("shows 'player' in the popup when the element title input receives '{'", () => {
    const location: FieldLocation = {
      kind: "element",
      menuId: MENU_ID,
      elementId: ELEMENT_ID,
    };

    render(<TitleInput location={location} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });

    // The popup opens and "player" appears (it shows in both .name and .type spans).
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByText("player").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'player' at menu scope too (no element-level extras needed)", () => {
    const location: FieldLocation = {
      kind: "menu",
      menuId: MENU_ID,
    };

    render(<TitleInput location={location} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "{" } });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByText("player").length).toBeGreaterThanOrEqual(1);
  });

  it("filters the popup: '{pl' matches player, no popup for a non-matching query", () => {
    const location: FieldLocation = {
      kind: "element",
      menuId: MENU_ID,
      elementId: ELEMENT_ID,
    };

    render(<TitleInput location={location} />);

    const input = screen.getByRole("combobox");
    // Partial query that matches "player"
    fireEvent.change(input, { target: { value: "{pl" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByText("player").length).toBeGreaterThanOrEqual(1);

    // Now query that matches nothing — empty-match row appears, not "player"
    fireEvent.change(input, { target: { value: "{zzz" } });
    expect(screen.queryAllByText("player")).toHaveLength(0);
    // Empty-match row contains the query text
    expect(screen.getByText(/zzz/)).toBeInTheDocument();
  });
});
