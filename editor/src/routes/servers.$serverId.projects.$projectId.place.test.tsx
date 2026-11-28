import { useServerPlaceHeader } from "@/features/serverPage/placeHeader";
import { ServerFrameContext } from "@/features/serverPage/serverFrame";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { ProjectTopBarControls } from "@/features/project/ProjectTopBarControls";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({
      to,
      children,
      params: _params,
      search: _search,
      ...rest
    }: { to: string; children: ReactNode; params?: unknown; search?: unknown }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => () => {},
    useParams: () => ({ serverId: "survie" }),
    useSearch: () => ({ tab: "resources" }),
  };
});

const project = {
  id: "srv.artisan",
  name: "artisan",
  defaultLang: "en",
  i18nKeys: {},
  documents: { menu: [], command: [], dialog: [] },
  assets: [],
} as never;
const frame = {
  serverId: "survie",
  serverKeyId: "k1",
  summary: { id: "k1", name: "survie", label: "Survie" } as never,
};

/** The header as the server's route gives it to the Project's page. */
function Place({ module = false }: { module?: boolean }) {
  const header = useServerPlaceHeader();
  return (
    <ProjectTopBarControls
      project={project}
      projectId={"srv.artisan" as never}
      place={module ? undefined : header}
    />
  );
}

describe("the header of a place of the server's resources", () => {
  it("stays the server's: its name, its tabs on Resources, and the place's draft tools", () => {
    render(
      <ServerFrameContext.Provider value={frame}>
        <Place />
      </ServerFrameContext.Provider>,
    );
    const header = screen.getByTestId("project-header");
    expect(within(header).getByTestId("place-server-name")).toBeInTheDocument();
    // The server's tabs, not a module's views.
    const tabs = within(header).getByRole("navigation", { name: "Sections du serveur" });
    expect(within(tabs).getByRole("link", { name: "Ressources" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByTestId("project-view-navigation")).toBeNull();
    expect(screen.queryByTestId("open-view-board")).toBeNull();
    // No canvas here: no undo, no language, no link to play this module.
    expect(screen.queryByTestId("project-editing-tools")).toBeNull();
    expect(screen.queryByTestId("project-play")).toBeNull();
    // What it holds is still deployed from here.
    expect(within(header).getByRole("button", { name: /^Déployer/ })).toBeInTheDocument();
  });

  it("is a module's header outside the server's page, and for a module", () => {
    const { unmount } = render(<Place />);
    expect(screen.getByTestId("project-header")).toBeInTheDocument();
    unmount();
    render(
      <ServerFrameContext.Provider value={frame}>
        <Place module />
      </ServerFrameContext.Provider>,
    );
    expect(screen.getByTestId("project-header")).toBeInTheDocument();
    expect(screen.queryByTestId("place-server-name")).toBeNull();
  });
});
