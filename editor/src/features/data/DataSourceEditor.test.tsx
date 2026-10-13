import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceEditor } from "./DataSourceEditor";

// The subject is the source editor, not CodeMirror: a textarea stands in for it.
vi.mock("@/components/ui/yaml-code-editor", () => ({
  YamlCodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const PID = "p1" as ProjectId;

function makeProject(sourceNames = ["settings"]): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    assets: [],
    dataModels: [],
    dataSources: sourceNames.map((name, index) =>
      ({
        id: `ds_${index + 1}` as never,
        name,
        shape: "config",
        fields: [{ name: "currency", type: { kind: "string" } }],
        value: { currency: "coins" },
      }) as const,
    ),
    i18nKeys: {} as Project["i18nKeys"],
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as unknown as Project;
}

const project = () => useAccountStore.getState().account.projects[0]!;

beforeEach(() => {
  useAccountStore.setState({
    account: { id: "acc" as never, projects: [makeProject()], projectOrder: [PID] },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DataSourceEditor", () => {
  it("asks for confirmation before deleting a data source", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);
    fireEvent.click(screen.getByText("Supprimer"));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(project().dataSources).toHaveLength(1);
  });

  it("deletes the data source when confirmed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);
    fireEvent.click(screen.getByText("Supprimer"));
    expect(project().dataSources).toHaveLength(0);
  });

  it("lowercases the name input and reports a duplicate without renaming", () => {
    useAccountStore.setState({
      account: {
        id: "acc" as never,
        projects: [makeProject(["settings", "grades"])],
        projectOrder: [PID],
      },
    } as never);
    render(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);
    const input = screen.getByRole("textbox", { name: "Nom de la source" });

    fireEvent.change(input, { target: { value: "GRADES" } });
    expect(input).toHaveValue("grades");
    fireEvent.blur(input);

    expect(screen.getByText("Une source porte déjà ce nom.")).toBeInTheDocument();
    expect(project().dataSources[0]!.name).toBe("settings");
  });

  // Form ↔ YAML switch

  it("montre le YAML de la source", () => {
    render(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);
    fireEvent.click(screen.getByRole("button", { name: "YAML" }));
    expect((screen.getByLabelText("data/ds_1.yaml") as HTMLTextAreaElement).value).toContain("coins");
  });

  /**
   * The reported defect: after a round trip through the YAML tab, an edit made
   * in the FORM was overwritten by a stale draft when coming back to YAML. The
   * tab must always reflect the current state.
   */
  it("relit l'état courant à chaque ouverture de l'onglet YAML", () => {
    const view = render(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);
    fireEvent.click(screen.getByRole("button", { name: "YAML" }));
    fireEvent.click(screen.getByRole("button", { name: "Formulaire" }));

    useAccountStore.getState().setSourceValue({
      projectId: PID, sourceId: "ds_1" as never, row: null, path: ["currency"], value: "jetons",
    });
    view.rerender(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);

    fireEvent.click(screen.getByRole("button", { name: "YAML" }));
    const shown = (screen.getByLabelText("data/ds_1.yaml") as HTMLTextAreaElement).value;
    expect(shown).toContain("jetons");
    expect(shown).not.toContain("coins");
  });

  it("un aller-retour sans rien toucher ne modifie pas la source", () => {
    render(<DataSourceEditor projectId={PID} source={project().dataSources[0]!} />);
    fireEvent.click(screen.getByRole("button", { name: "YAML" }));
    fireEvent.click(screen.getByRole("button", { name: "Formulaire" }));
    const s = project().dataSources[0]!;
    if (s.shape !== "config") throw new Error("config attendu");
    expect(s.value).toEqual({ currency: "coins" });
  });
});
