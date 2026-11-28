import type { Project, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleCatalogue } from "./ModuleCatalogue";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ serverId: "srv" }),
  useRouter: () => null,
}));

const PID = "p1" as ProjectId;
function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [
        { id: "main", projectId: PID, title: [], rows: 3, layers: [] },
        { id: "ranks", projectId: PID, title: [], rows: 3, layers: [], folder: "guild" },
      ],
      command: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] }],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

beforeEach(() => {
  useProjectsStore.setState({
    openProjects: { projects: [project()], projectOrder: [PID] },
  } as never);
});

describe("ModuleCatalogue", () => {
  it("lists every Document as a card, kind after kind, with each kind's count", () => {
    render(
      <ModuleCatalogue project={project()} kind={undefined} onKind={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(
      within(screen.getByRole("list", { name: /menus/i })).getAllByRole("button"),
    ).toHaveLength(2);
    expect(screen.getByTestId("catalogue-doc-command/c1")).toHaveTextContent("/heal");
    expect(screen.getByTestId("catalogue-kind-menu")).toHaveTextContent("2");
    // The folder a Document is filed in shows under its name.
    expect(screen.getByTestId("catalogue-doc-menu/ranks")).toHaveTextContent("guild");
  });

  it("opens the Document of a card by its key", () => {
    const onOpen = vi.fn();
    render(
      <ModuleCatalogue project={project()} kind={undefined} onKind={vi.fn()} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByTestId("catalogue-doc-menu/main"));
    expect(onOpen).toHaveBeenCalledWith("menu/main");
  });

  it("shows one kind alone when asked, and a chip clicked again goes back to all", () => {
    const onKind = vi.fn();
    const { rerender } = render(
      <ModuleCatalogue project={project()} kind="command" onKind={onKind} onOpen={vi.fn()} />,
    );
    expect(screen.queryByTestId("catalogue-doc-menu/main")).toBeNull();
    expect(screen.getByTestId("catalogue-doc-command/c1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("catalogue-kind-command"));
    expect(onKind).toHaveBeenCalledWith(undefined);
    rerender(
      <ModuleCatalogue project={project()} kind="command" onKind={onKind} onOpen={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("catalogue-kind-menu"));
    expect(onKind).toHaveBeenLastCalledWith("menu");
  });

  it("narrows by a search on the name, the id or the folder", () => {
    render(
      <ModuleCatalogue project={project()} kind={undefined} onKind={vi.fn()} onOpen={vi.fn()} />,
    );
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "guild" } });
    expect(screen.getByTestId("catalogue-doc-menu/ranks")).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-doc-menu/main")).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryByTestId("catalogue-doc-menu/ranks")).toBeNull();
    expect(screen.getByText(/No Document matches|Aucun document/)).toBeInTheDocument();
  });

  it("is absent from a module that holds no Document", () => {
    const empty = { ...project(), documents: { menu: [], command: [], dialog: [] } } as Project;
    const { container } = render(
      <ModuleCatalogue project={empty} kind={undefined} onKind={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
