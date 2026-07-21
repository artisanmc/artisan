import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { ModelFieldsEditor } from "./ModelFieldsEditor";
import { SourceRowsTable } from "./SourceValueEditor";

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
    templates: [],
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

const pack = () => useAccountStore.getState().account.projects[0]!;
const tableSource = () => pack().dataSources[0] as Extract<Project["dataSources"][number], { shape: "table" }>;

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "acc" as never, projects: [makeProject()], projectOrder: [PID] },
  } as never);
  useUiStore.setState({ activeLang: "en" } as never);
});

describe("SourceRowsTable", () => {
  it("renders one column per declared field and the row's values", () => {
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("vip")).toBeInTheDocument();
    // ltext cell shows the active-language text, not the key.
    expect(screen.getByDisplayValue("VIP")).toBeInTheDocument();
  });

  it("edits a string cell through setSourceValue", () => {
    const view = render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    const input = screen.getByDisplayValue("vip");
    fireEvent.change(input, { target: { value: "gold" } });
    expect(tableSource().rows[0]!.id).toBe("vip");
    fireEvent.blur(input);
    expect(tableSource().rows[0]!.id).toBe("gold");
    view.rerender(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    expect(screen.getByDisplayValue("gold")).toBeInTheDocument();
  });

  it("shows a duplicate Row key error without changing the stored value", () => {
    useAccountStore.getState().addSourceRow({ projectId: PID, sourceId: "ranks" as never });
    useAccountStore
      .getState()
      .setSourceValue({ projectId: PID, sourceId: "ranks" as never, row: 1, path: ["id"], value: "member" });
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);

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
    const view = render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);

    const input = screen.getByDisplayValue("vip");
    fireEvent.change(input, { target: { value: " member " } });
    fireEvent.blur(input);
    expect(screen.getByText("Une ligne porte déjà cet ID.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("Supprimer la row")[0]!);
    view.rerender(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);

    const reusedInput = screen.getByDisplayValue("member");
    expect(reusedInput).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("Une ligne porte déjà cet ID.")).toBeNull();
  });

  it("shows a required Row key error without changing the stored value", () => {
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    const input = screen.getByDisplayValue("vip");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(screen.getByText("L’ID de la ligne est obligatoire.")).toBeInTheDocument();
    expect(tableSource().rows[0]!.id).toBe("vip");
    expect(input).toHaveValue("vip");
  });

  it("commits a Row key on Enter", () => {
    const view = render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    const input = screen.getByDisplayValue("vip");
    input.focus();
    fireEvent.change(input, { target: { value: " ELITE " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(tableSource().rows[0]!.id).toBe("elite");
    view.rerender(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    expect(screen.getByDisplayValue("elite")).toBeInTheDocument();
    expect(screen.queryByText("Une ligne porte déjà cet ID.")).toBeNull();
    expect(screen.queryByText("L’ID de la ligne est obligatoire.")).toBeNull();
  });

  it("edits an ltext cell through the i18n write path (active language)", () => {
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.change(screen.getByDisplayValue("VIP"), { target: { value: "V.I.P." } });
    expect(pack().i18nKeys["sources.ranks.vip.name" as never]).toEqual({ en: "V.I.P." });
  });

  it("renders a scrollable sheet: overflow wrapper + non-squeezable table", () => {
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    const sheet = screen.getByTestId("source-rows-sheet");
    expect(sheet.className).toContain("overflow-auto");
    const table = sheet.querySelector("table")!;
    expect(table.className).toContain("min-w-max");
  });

  it("minimessage cell shows a rendered facade, edits raw markup on click", () => {
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
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
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.click(screen.getByRole("button", { name: /No refund/ }));
    const editor = screen.getByDisplayValue(/No refund/) as HTMLTextAreaElement;
    expect(editor.tagName).toBe("TEXTAREA");
    fireEvent.change(editor, { target: { value: "line1\nline2" } });
    expect(tableSource().rows[0]!.rules).toBe("line1\nline2");
  });

  it("adds a row with minted ltexts and removes it releasing them", () => {
    const view = render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.click(screen.getByText("+ Row"));
    expect(tableSource().rows).toHaveLength(2);
    const minted = tableSource().rows[1]!.name as { key: string };
    expect(tableSource().rows[1]!.id).toBe("row_1");
    expect(minted.key).toBe("sources.ranks.row_1.name");
    expect(pack().i18nKeys[minted.key as never]).toBeDefined();

    view.rerender(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    const removeButtons = screen.getAllByLabelText("Supprimer la row");
    fireEvent.click(removeButtons[1]!);
    expect(tableSource().rows).toHaveLength(1);
    expect(pack().i18nKeys[minted.key as never]).toBeUndefined();
  });
});

describe("ModelFieldsEditor", () => {
  it("hides the add-field draft behind a button — no phantom 'already added' row", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    expect(screen.queryByPlaceholderText("Nom du champ")).toBeNull();
    fireEvent.click(screen.getByText("Ajouter un champ"));
    // Draft opens, focused, ready to type.
    expect(screen.getByPlaceholderText("Nom du champ")).toHaveFocus();
  });

  it("Escape closes the draft without adding anything", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    const fieldCount = pack().dataModels![0]!.fields.length;
    fireEvent.click(screen.getByText("Ajouter un champ"));
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "icon" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Nom du champ"), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Nom du champ")).toBeNull();
    expect(pack().dataModels![0]!.fields).toHaveLength(fieldCount);
  });

  it("adds a declared field through editSourceField (rows migrate), draft stays open for multi-add", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.click(screen.getByText("Ajouter un champ"));
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "icon" } });
    const selects = screen.getAllByRole("combobox");
    // Last kind-select is the add-row's.
    fireEvent.change(selects[selects.length - 1]!, { target: { value: "item" } });
    fireEvent.click(screen.getByLabelText("Ajouter"));
    const model = pack().dataModels![0]!;
    expect(model.fields.some((f) => f.name === "icon" && f.type.kind === "item")).toBe(true);
    expect(tableSource().rows[0]!.icon).toBe("");
    // Multi-add: draft stays open, name cleared for the next field.
    expect(screen.getByPlaceholderText("Nom du champ")).toHaveValue("");
  });

  it("adds a minimessage_multiline field (rows seed an empty string)", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.click(screen.getByText("Ajouter un champ"));
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "lore" } });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[selects.length - 1]!, { target: { value: "minimessage_multiline" } });
    fireEvent.click(screen.getByLabelText("Ajouter"));
    const model = pack().dataModels![0]!;
    expect(
      model.fields.some((f) => f.name === "lore" && f.type.kind === "minimessage_multiline"),
    ).toBe(true);
    expect(tableSource().rows[0]!.lore).toBe("");
  });

  it("renames a field on blur and migrates the row data", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    const priceInput = screen.getByDisplayValue("price");
    fireEvent.change(priceInput, { target: { value: "cost" } });
    fireEvent.blur(priceInput);
    expect(pack().dataModels![0]!.fields.some((f) => f.name === "cost")).toBe(true);
    expect(tableSource().rows[0]!.cost).toBe(9.99);
    expect(tableSource().rows[0]!.price).toBeUndefined();
  });

  it("removes a field and releases its translations", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.click(screen.getByLabelText("Supprimer le champ name"));
    expect(pack().dataModels![0]!.fields.some((f) => f.name === "name")).toBe(false);
    expect(pack().i18nKeys["sources.ranks.vip.name" as never]).toBeUndefined();
  });

  it("changes the Row key via the selector", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    const keySelect = screen.getByLabelText("Clé");
    fireEvent.change(keySelect, { target: { value: "id" } });
    expect(pack().dataModels![0]!.keyField).toBe("id");
  });
});
