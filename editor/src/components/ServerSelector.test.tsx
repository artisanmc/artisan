import { useServersStore } from "@/state/serversStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ServerEntry, ServerSelector } from "./ServerSelector";

const mockParams = vi.hoisted(() => ({
  current: {} as { serverId?: string },
}));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams.current,
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const SERVERS: ServerEntry[] = [
  { serverId: "sk_1", serverLabel: "Survival" },
  { serverId: "sk_2", serverLabel: "Creatif" },
];

describe("ServerSelector", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockParams.current = {};
    useServersStore.setState({ activeServerId: null });
  });

  it("persists the selection in the servers store and navigates", async () => {
    render(<ServerSelector servers={SERVERS} />);
    await userEvent.click(screen.getByText(/Sélectionner un serveur|Select a server/));
    await userEvent.click(screen.getByText("Creatif"));
    expect(useServersStore.getState().activeServerId).toBe("sk_2");
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/servers/$serverId",
      params: { serverId: "sk_2" },
    });
  });

  it("navigates with the server slug when it has one", async () => {
    render(<ServerSelector servers={[{ ...SERVERS[0]!, serverSlug: "survival" }]} />);
    await userEvent.click(screen.getByText(/Sélectionner un serveur|Select a server/));
    await userEvent.click(screen.getByText("Survival"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/servers/$serverId",
      params: { serverId: "survival" },
    });
  });

  it("shows each server's connected state, and update required over it", async () => {
    render(
      <ServerSelector
        servers={[
          { ...SERVERS[0]!, online: true },
          { ...SERVERS[1]!, online: false },
          {
            ...SERVERS[0]!,
            serverId: "sk_3",
            serverLabel: "Lobby",
            online: true,
            updateRequired: true,
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByText(/Sélectionner un serveur|Select a server/));
    expect(screen.getByTestId("server-state-online")).toBeInTheDocument();
    expect(screen.getByTestId("server-state-offline")).toHaveTextContent(/Offline|Hors ligne/);
    expect(screen.getByTestId("server-state-updateRequired")).toHaveTextContent(
      /Update required|Mise à jour requise/,
    );
  });

  it("shows the persisted server as active on routes without a serverId param", () => {
    useServersStore.setState({ activeServerId: "sk_1" });
    render(<ServerSelector servers={SERVERS} />);
    expect(screen.getByText("Survival")).toBeInTheDocument();
    expect(screen.queryByText(/Sélectionner un serveur|Select a server/)).toBeNull();
  });
});
