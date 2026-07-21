import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceEditor } from "./DataSourceEditor";

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
    templates: [],
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

const pack = () => useAccountStore.getState().account.projects[0]!;

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
    render(<DataSourceEditor projectId={PID} source={pack().dataSources[0]!} />);
    fireEvent.click(screen.getByText("Supprimer"));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(pack().dataSources).toHaveLength(1);
  });

  it("deletes the data source when confirmed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DataSourceEditor projectId={PID} source={pack().dataSources[0]!} />);
    fireEvent.click(screen.getByText("Supprimer"));
    expect(pack().dataSources).toHaveLength(0);
  });

  it("lowercases the name input and reports a duplicate without renaming", () => {
    useAccountStore.setState({
      account: {
        id: "acc" as never,
        projects: [makeProject(["settings", "grades"])],
        projectOrder: [PID],
      },
    } as never);
    render(<DataSourceEditor projectId={PID} source={pack().dataSources[0]!} />);
    const input = screen.getByRole("textbox", { name: "Nom de la source" });

    fireEvent.change(input, { target: { value: "GRADES" } });
    expect(input).toHaveValue("grades");
    fireEvent.blur(input);

    expect(screen.getByText("Une source porte déjà ce nom.")).toBeInTheDocument();
    expect(pack().dataSources[0]!.name).toBe("settings");
  });
});
