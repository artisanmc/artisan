import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { ModelFieldsEditor } from "./ModelFieldsEditor";
import { ConfigValueForm, SourceRowsTable } from "./SourceValueEditor";

const PID = "p1" as ProjectId;

function makeProject(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    assets: [],
    dataModels: [
      {
        id: "m_rank" as never,
        name: "rank",
        keyField: "id",
        fields: [
          { name: "id", type: { kind: "string" } },
          { name: "name", type: { kind: "ltext" } },
          { name: "price", type: { kind: "number" } },
          { name: "tagline", type: { kind: "minimessage" } },
          { name: "rules", type: { kind: "minimessage_multiline" } },
        ],
      },
    ],
    dataSources: [
      {
        id: "ranks" as never,
        name: "ranks",
        shape: "table",
        modelId: "m_rank" as never,
        rows: [
          {
            id: "vip",
            name: { key: "sources.ranks.vip.name" },
            price: 9.99,
            tagline: "<gold>Best</gold> rank",
            rules: "<red>No refund</red>\nBe nice",
          },
        ],
      },
    ],
    i18nKeys: { ["sources.ranks.vip.name" as never]: { en: "VIP" } } as Project["i18nKeys"],
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as unknown as Project;
}

const project = () => useAccountStore.getState().account.projects[0]!;
const tableSource = () => project().dataSources[0] as Extract<Project["dataSources"][number], { shape: "table" }>;

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "acc" as never, projects: [makeProject()], projectOrder: [PID] },
  } as never);
  useUiStore.setState({ activeLang: "en" } as never);
});

describe("SourceRowsTable", () => {
  it("renders one column per declared field and the row's values", () => {
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("vip")).toBeInTheDocument();
    // ltext cell shows the active-language text, not the key.
    expect(screen.getByDisplayValue("VIP")).toBeInTheDocument();
  });

  it("edits a string cell through setSourceValue", () => {
    const view = render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const input = screen.getByDisplayValue("vip");
    fireEvent.change(input, { target: { value: "gold" } });
    expect(tableSource().rows[0]!.id).toBe("vip");
    fireEvent.blur(input);
    expect(tableSource().rows[0]!.id).toBe("gold");
    view.rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getByDisplayValue("gold")).toBeInTheDocument();
  });

  it("shows a duplicate Row key error without changing the stored value", () => {
    useAccountStore.getState().addSourceRow({ projectId: PID, sourceId: "ranks" as never });
    useAccountStore
      .getState()
      .setSourceValue({ projectId: PID, sourceId: "ranks" as never, row: 1, path: ["id"], value: "member" });
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);

    const input = screen.getByDisplayValue("member");
    fireEvent.change(input, { target: { value: " VIP " } });
    fireEvent.blur(input);

    expect(screen.getByText("Une ligne porte déjà cet ID.")).toBeInTheDocument();
    expect(tableSource().rows[1]!.id).toBe("member");
    expect(input).toHaveValue("member");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("clears a Row key error when an index-keyed editor is reused", () => {
    useAccountStore.getState().addSourceRow({ projectId: PID, sourceId: "ranks" as never });
    useAccountStore
      .getState()
      .setSourceValue({ projectId: PID, sourceId: "ranks" as never, row: 1, path: ["id"], value: "member" });
    const view = render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);

    const input = screen.getByDisplayValue("vip");
    fireEvent.change(input, { target: { value: " member " } });
    fireEvent.blur(input);
    expect(screen.getByText("Une ligne porte déjà cet ID.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("Supprimer la row")[0]!);
    view.rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);

    const reusedInput = screen.getByDisplayValue("member");
    expect(reusedInput).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("Une ligne porte déjà cet ID.")).toBeNull();
  });

  it("shows a required Row key error without changing the stored value", () => {
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const input = screen.getByDisplayValue("vip");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(screen.getByText("L’ID de la ligne est obligatoire.")).toBeInTheDocument();
    expect(tableSource().rows[0]!.id).toBe("vip");
    expect(input).toHaveValue("vip");
  });

  it("commits a Row key on Enter", () => {
    const view = render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const input = screen.getByDisplayValue("vip");
    input.focus();
    fireEvent.change(input, { target: { value: " ELITE " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(tableSource().rows[0]!.id).toBe("elite");
    view.rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getByDisplayValue("elite")).toBeInTheDocument();
    expect(screen.queryByText("Une ligne porte déjà cet ID.")).toBeNull();
    expect(screen.queryByText("L’ID de la ligne est obligatoire.")).toBeNull();
  });

  it("edits an ltext cell through the i18n write path (active language)", () => {
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.change(screen.getByDisplayValue("VIP"), { target: { value: "V.I.P." } });
    expect(project().i18nKeys["sources.ranks.vip.name" as never]).toEqual({ en: "V.I.P." });
  });

  it("renders a scrollable sheet: overflow wrapper + non-squeezable table", () => {
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const sheet = screen.getByTestId("source-rows-sheet");
    expect(sheet.className).toContain("overflow-auto");
    const table = sheet.querySelector("table")!;
    expect(table.className).toContain("min-w-max");
  });

  it("minimessage cell shows a rendered facade, edits raw markup on click", () => {
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    // At rest: rendered facade — tags consumed, no raw markup in an input.
    // (accessible name concatenates spans without inter-element spaces)
    const facade = screen.getByRole("button", { name: /Best\s*rank/ });
    expect(facade.textContent).not.toContain("<gold>");
    fireEvent.click(facade);
    const editor = screen.getByDisplayValue("<gold>Best</gold> rank");
    fireEvent.change(editor, { target: { value: "<red>Worst</red>" } });
    expect(tableSource().rows[0]!.tagline).toBe("<red>Worst</red>");
  });

  it("minimessage_multiline cell edits in a textarea", () => {
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.click(screen.getByRole("button", { name: /No refund/ }));
    const editor = screen.getByDisplayValue(/No refund/) as HTMLTextAreaElement;
    expect(editor.tagName).toBe("TEXTAREA");
    fireEvent.change(editor, { target: { value: "line1\nline2" } });
    expect(tableSource().rows[0]!.rules).toBe("line1\nline2");
  });

  it("adds a row with minted ltexts and removes it releasing them", () => {
    const view = render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.click(screen.getByText("+ Row"));
    expect(tableSource().rows).toHaveLength(2);
    const minted = tableSource().rows[1]!.name as { key: string };
    expect(tableSource().rows[1]!.id).toBe("row_1");
    expect(minted.key).toBe("sources.ranks.row_1.name");
    expect(project().i18nKeys[minted.key as never]).toBeDefined();

    view.rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const removeButtons = screen.getAllByLabelText("Supprimer la row");
    fireEvent.click(removeButtons[1]!);
    expect(tableSource().rows).toHaveLength(1);
    expect(project().i18nKeys[minted.key as never]).toBeUndefined();
  });
});

describe("ModelFieldsEditor", () => {
  it("hides the add-field draft behind a button — no phantom 'already added' row", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.queryByPlaceholderText("Nom du champ")).toBeNull();
    fireEvent.click(screen.getByText("Ajouter un champ"));
    // Draft opens, focused, ready to type.
    expect(screen.getByPlaceholderText("Nom du champ")).toHaveFocus();
  });

  it("Escape closes the draft without adding anything", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    const fieldCount = project().dataModels![0]!.fields.length;
    fireEvent.click(screen.getByText("Ajouter un champ"));
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "icon" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Nom du champ"), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Nom du champ")).toBeNull();
    expect(project().dataModels![0]!.fields).toHaveLength(fieldCount);
  });

  it("adds a declared field through editSourceField (rows migrate), draft stays open for multi-add", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.click(screen.getByText("Ajouter un champ"));
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "icon" } });
    const selects = screen.getAllByRole("combobox");
    // Last kind-select is the add-row's.
    fireEvent.change(selects[selects.length - 1]!, { target: { value: "item" } });
    fireEvent.click(screen.getByLabelText("Ajouter"));
    const model = project().dataModels![0]!;
    expect(model.fields.some((f) => f.name === "icon" && f.type.kind === "item")).toBe(true);
    expect(tableSource().rows[0]!.icon).toBe("");
    // Multi-add: draft stays open, name cleared for the next field.
    expect(screen.getByPlaceholderText("Nom du champ")).toHaveValue("");
  });

  it("adds a minimessage_multiline field (rows seed an empty string)", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.click(screen.getByText("Ajouter un champ"));
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "lore" } });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[selects.length - 1]!, { target: { value: "minimessage_multiline" } });
    fireEvent.click(screen.getByLabelText("Ajouter"));
    const model = project().dataModels![0]!;
    expect(
      model.fields.some((f) => f.name === "lore" && f.type.kind === "minimessage_multiline"),
    ).toBe(true);
    expect(tableSource().rows[0]!.lore).toBe("");
  });

  it("renames a field on blur and migrates the row data", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    const priceInput = screen.getByDisplayValue("price");
    fireEvent.change(priceInput, { target: { value: "cost" } });
    fireEvent.blur(priceInput);
    expect(project().dataModels![0]!.fields.some((f) => f.name === "cost")).toBe(true);
    expect(tableSource().rows[0]!.cost).toBe(9.99);
    expect(tableSource().rows[0]!.price).toBeUndefined();
  });

  it("removes a field and releases its translations", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.click(screen.getByLabelText("Supprimer le champ name"));
    expect(project().dataModels![0]!.fields.some((f) => f.name === "name")).toBe(false);
    expect(project().i18nKeys["sources.ranks.vip.name" as never]).toBeUndefined();
  });

  it("changes the Row key via the selector", () => {
    render(<ModelFieldsEditor projectId={PID} project={project()} source={tableSource()} />);
    const keySelect = screen.getByLabelText("Clé");
    fireEvent.change(keySelect, { target: { value: "id" } });
    expect(project().dataModels![0]!.keyField).toBe("id");
  });
});

// ─── stable row identity (model-ref "items mixed across rows" regression) ────
// Index keys made React reuse a stateful child (RowKeyEditor draft) for a
// DIFFERENT row after a mid-list delete. Keys are now identity-derived from
// the Row key value.
describe("SourceRowsTable — stable row keys", () => {
  it("keeps a row's in-progress key draft bound to the SAME row when the row above is deleted", () => {
    useAccountStore.setState((s) => {
      const p = s.account.projects[0]!;
      const ds = p.dataSources[0] as { rows: Record<string, unknown>[] };
      ds.rows = [
        { id: "alpha", name: { key: "k_a" }, price: 1, tagline: "", rules: "" },
        { id: "beta", name: { key: "k_b" }, price: 2, tagline: "", rules: "" },
      ];
      return s;
    });
    const { rerender } = render(
      <SourceRowsTable projectId={PID} project={project()} source={tableSource()} />,
    );

    // Start typing a new key on the SECOND row (beta) without committing.
    const keyInputs = screen.getAllByDisplayValue(/alpha|beta/);
    const betaInput = keyInputs.find((el) => (el as HTMLInputElement).value === "beta")!;
    fireEvent.change(betaInput, { target: { value: "beta-renamed" } });
    expect((betaInput as HTMLInputElement).value).toBe("beta-renamed");

    // Delete the FIRST row (alpha) from the store (as the ✕ button would).
    useAccountStore.setState((s) => {
      const p = s.account.projects[0]!;
      const ds = p.dataSources[0] as { rows: Record<string, unknown>[] };
      ds.rows = ds.rows.filter((r) => r.id !== "alpha");
      return s;
    });
    rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);

    // The surviving row must still be BETA's instance: its uncommitted draft
    // ("beta-renamed") stays bound to it — with index keys, beta slid into
    // alpha's slot and the draft was lost/mismatched.
    expect(screen.queryByDisplayValue("alpha")).toBeNull();
    expect(screen.getByDisplayValue("beta-renamed")).toBeTruthy();
  });
});

// ─── composable kinds widgets (map / enum / union) ───────────────────────────

describe("ValueEditor — map / enum / union widgets", () => {
  function seedComposable() {
    useAccountStore.setState((s) => {
      const p = s.account.projects[0]!;
      p.dataModels = [
        {
          id: "m_q" as never,
          name: "quest",
          keyField: "id",
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "strategy", type: { kind: "enum", values: ["sequential", "random"] } },
            {
              name: "act",
              type: {
                kind: "union",
                tag: "type",
                variants: [
                  { name: "message", fields: [{ name: "text", type: { kind: "string" } }] },
                  { name: "command", fields: [{ name: "run", type: { kind: "string" } }] },
                ],
              },
            },
            { name: "prices", type: { kind: "map", of: { kind: "number" } } },
          ],
        },
      ] as never;
      p.dataSources = [
        {
          id: "quests" as never,
          name: "quests",
          shape: "table",
          modelId: "m_q" as never,
          rows: [
            {
              id: "daily",
              strategy: "sequential",
              act: { type: "message", text: "hello" },
              prices: { gold: 5 },
            },
          ],
        },
      ] as never;
      return s;
    });
  }

  it("enum renders a closed select and commits the chosen value", () => {
    seedComposable();
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const select = screen.getByRole("combobox", { name: "strategy" });
    fireEvent.change(select, { target: { value: "random" } });
    expect((project().dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!.strategy).toBe("random");
  });

  it("union renders the active variant's fields; switching variants rebuilds the value", () => {
    seedComposable();
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    // Active variant "message" shows its `text` field.
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();
    const tagSelect = screen.getByRole("combobox", { name: "type" });
    fireEvent.change(tagSelect, { target: { value: "command" } });
    const act = (project().dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!
      .act as Record<string, unknown>;
    expect(act.type).toBe("command");
    expect(act.run).toBe("");
    expect(act.text).toBeUndefined();
  });

  it("map lists entries, adds with a fresh key, removes an entry", () => {
    seedComposable();
    const view = render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getByText("gold")).toBeInTheDocument();
    // Add an entry.
    fireEvent.change(screen.getByPlaceholderText(/key|clé/), { target: { value: "gems" } });
    fireEvent.click(screen.getByRole("button", { name: /add entry|ajouter une entrée/i }));
    let prices = (project().dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!
      .prices as Record<string, unknown>;
    expect(prices.gems).toBe(0);
    // Re-render from the fresh store (the app re-renders via its store
    // subscription; here project travels by prop), then remove the original entry.
    view.rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    fireEvent.click(screen.getByRole("button", { name: /remove entry gold|supprimer l'entrée gold/i }));
    prices = (project().dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!
      .prices as Record<string, unknown>;
    expect(prices.gold).toBeUndefined();
    expect(prices.gems).toBe(0);
  });
});

// ─── slice 3: hints, asymmetric validation, master-detail, conditions ────────

describe("form generator — hints + validation (§7)", () => {
  function seedHinted(masterDetail = false) {
    useAccountStore.setState((s) => {
      const p = s.account.projects[0]!;
      p.dataModels = [
        {
          id: "m_h" as never,
          name: "hinted",
          keyField: "id",
          ...(masterDetail ? { masterDetail: true } : {}),
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "price", type: { kind: "number" }, label: "Price (coins)", help: "Base price", min: 0, max: 100 },
            { name: "icon", type: { kind: "string" }, locked: true },
            { name: "gate", type: { kind: "conditions" }, label: "Visibility" },
          ],
        },
      ] as never;
      p.dataSources = [
        {
          id: "hinted" as never,
          name: "hinted",
          shape: "table",
          modelId: "m_h" as never,
          rows: [
            { id: "a", price: 250, icon: "item:ci_locked", gate: [] },
            { id: "b", price: 5, icon: "item:ci_other", gate: [] },
          ],
        },
      ] as never;
      return s;
    });
  }

  it("shows the label hint, clamps min/max on commit, flags an out-of-bounds stored value", () => {
    seedHinted();
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getAllByText("Price (coins)").length).toBeGreaterThan(0);
    // Stored 250 > max 100 (hand-edit scenario): surfaced, not rewritten.
    const priceA = screen.getByDisplayValue("250");
    expect(priceA).toHaveAttribute("aria-invalid", "true");
    expect((project().dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!.price).toBe(250);
    // Committing through the form clamps (blocking by construction).
    fireEvent.change(priceA, { target: { value: "999" } });
    expect((project().dataSources[0] as { rows: Record<string, unknown>[] }).rows[0]!.price).toBe(100);
  });

  it("locked fields render read-only (no input)", () => {
    seedHinted();
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getAllByTestId("locked-icon").length).toBe(2); // one per row
    expect(screen.queryByDisplayValue("item:ci_locked")).toBeNull();
  });

  it("conditions kind renders the core condition editor", () => {
    seedHinted();
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    expect(screen.getAllByTestId("conditions-gate").length).toBe(2);
  });

  it("master_detail renders the row list + selected row form instead of the spreadsheet", () => {
    seedHinted(true);
    render(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);
    const md = screen.getByTestId("source-master-detail");
    expect(md).toBeTruthy();
    expect(screen.queryByTestId("source-rows-sheet")).toBeNull();
    // Master list shows both row keys; first selected by default.
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(screen.getByDisplayValue("5")).toBeTruthy();
  });

  // Renaming the Row key must not drop the selection: identity moved, the row
  // didn't. Before the fix the detail pane fell back to "no rows" and the user
  // had to re-click the row in the master list.
  it("keeps the selected row when its Row key is renamed", () => {
    seedHinted(true);
    const { rerender } = render(
      <SourceRowsTable projectId={PID} project={project()} source={tableSource()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "bb" } });
    // The store drives the re-render in the app; mirror that here.
    rerender(<SourceRowsTable projectId={PID} project={project()} source={tableSource()} />);

    // The detail form is still the same row (price 5), now keyed "bb".
    expect(screen.getByDisplayValue("5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "bb" })).toHaveAttribute("aria-current", "true");
  });
});

// ─── untyped config source (ADR bare-data-files: never a dead end) ───────────

describe("ConfigValueForm — schemaless file", () => {
  function seedUntyped() {
    useAccountStore.setState((s) => {
      const p = s.account.projects[0]!;
      p.dataModels = [];
      p.dataSources = [
        {
          id: "shop_settings" as never,
          name: "shop_settings",
          shape: "config",
          fields: [],
          value: { whole_shop_discount: 10, label: "Soldes" },
        },
      ] as never;
      return s;
    });
  }

  // A bare data file with no schema beside it must still be editable from its
  // literal values — an empty form is a dead end for the admin.
  it("renders one input per stored key when the source carries no fields", () => {
    seedUntyped();
    const source = project().dataSources[0] as never;
    render(<ConfigValueForm projectId={PID} project={project()} source={source} />);
    expect(screen.getByDisplayValue("10")).toBeTruthy();
    expect(screen.getByDisplayValue("Soldes")).toBeTruthy();
  });

  it("edits write back through the store", () => {
    seedUntyped();
    const source = project().dataSources[0] as never;
    render(<ConfigValueForm projectId={PID} project={project()} source={source} />);
    fireEvent.change(screen.getByDisplayValue("10"), { target: { value: "25" } });
    const v = (project().dataSources[0] as { value: Record<string, unknown> }).value;
    expect(v.whole_shop_discount).toBe(25);
  });
});

// ─── ADR yaml-assisted-editing ⑨: hints are visible, the key stays visible ───

describe("field hints in the form", () => {
  function seedHinted() {
    useAccountStore.setState((s) => {
      const p = s.account.projects[0]!;
      p.dataModels = [];
      p.dataSources = [
        {
          id: "shop_settings" as never,
          name: "shop_settings",
          shape: "config",
          fields: [
            {
              name: "whole_shop_discount",
              type: { kind: "integer" },
              label: "Remise globale",
              help: "Remise appliquée à toute la boutique (0 à 100).",
            },
          ],
          value: { whole_shop_discount: 10 },
        },
      ] as never;
      return s;
    });
  }

  it("shows the description as text, not only as a tooltip", () => {
    seedHinted();
    render(<ConfigValueForm projectId={PID} project={project()} source={project().dataSources[0] as never} />);
    expect(screen.getByText(/Remise appliquée à toute la boutique/)).toBeInTheDocument();
  });

  it("shows the label AND the technical key — the key is what the file uses", () => {
    seedHinted();
    render(<ConfigValueForm projectId={PID} project={project()} source={project().dataSources[0] as never} />);
    expect(screen.getByText("Remise globale")).toBeInTheDocument();
    expect(screen.getByText("whole_shop_discount")).toBeInTheDocument();
  });
});
