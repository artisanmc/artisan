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
        ],
      },
    ],
    dataSources: [
      {
        id: "ranks" as never,
        name: "ranks",
        shape: "table",
        modelId: "m_rank" as never,
        rows: [{ id: "vip", name: { key: "sources.ranks.vip.name" }, price: 9.99 }],
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
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.change(screen.getByDisplayValue("vip"), { target: { value: "gold" } });
    expect(tableSource().rows[0]!.id).toBe("gold");
  });

  it("edits an ltext cell through the i18n write path (active language)", () => {
    render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.change(screen.getByDisplayValue("VIP"), { target: { value: "V.I.P." } });
    expect(pack().i18nKeys["sources.ranks.vip.name" as never]).toEqual({ en: "V.I.P." });
  });

  it("adds a row with minted ltexts and removes it releasing them", () => {
    const view = render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.click(screen.getByText("+ Row"));
    expect(tableSource().rows).toHaveLength(2);
    const minted = tableSource().rows[1]!.name as { key: string };
    expect(minted.key).not.toBe("");
    expect(pack().i18nKeys[minted.key as never]).toBeDefined();

    view.rerender(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);
    const removeButtons = screen.getAllByLabelText("Supprimer la row");
    fireEvent.click(removeButtons[1]!);
    expect(tableSource().rows).toHaveLength(1);
    expect(pack().i18nKeys[minted.key as never]).toBeUndefined();
  });
});

describe("ModelFieldsEditor", () => {
  it("adds a declared field through editSourceField (rows migrate)", () => {
    render(<ModelFieldsEditor projectId={PID} pack={pack()} source={tableSource()} />);
    fireEvent.change(screen.getByPlaceholderText("Nom du champ"), { target: { value: "icon" } });
    const selects = screen.getAllByRole("combobox");
    // Last kind-select is the add-row's.
    fireEvent.change(selects[selects.length - 1]!, { target: { value: "item" } });
    fireEvent.click(screen.getByText("Ajouter un champ"));
    const model = pack().dataModels![0]!;
    expect(model.fields.some((f) => f.name === "icon" && f.type.kind === "item")).toBe(true);
    expect(tableSource().rows[0]!.icon).toBe("");
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
