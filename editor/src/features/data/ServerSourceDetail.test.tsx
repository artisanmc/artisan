import type { ServerDataSource } from "@/lib/api/dataSources";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSourceDetail } from "./ServerSourceDetail";

const previewDataSource = vi.fn();
vi.mock("@/lib/api/dataSources", async () => {
  const actual = await vi.importActual<object>("@/lib/api/dataSources");
  return { ...actual, previewDataSource: (...a: unknown[]) => previewDataSource(...a) };
});
const getNetworkServersStatus = vi.fn();
vi.mock("@/lib/api/networks", async () => {
  const actual = await vi.importActual<object>("@/lib/api/networks");
  return { ...actual, getNetworkServersStatus: (...a: unknown[]) => getNetworkServersStatus(...a) };
});

const source: ServerDataSource = {
  ref: "boutique:items",
  moduleId: "boutique",
  schema: [{ name: "price", type: "number", description: "Unit price" }],
  schemaHint: null,
};

describe("ServerSourceDetail", () => {
  beforeEach(() => {
    previewDataSource.mockReset();
    getNetworkServersStatus.mockReset();
    getNetworkServersStatus.mockResolvedValue({
      servers: [{ id: "sk1", online: true }],
      online: 1,
      total: 1,
    });
  });

  it("renders ref, module badge, and the schema table", async () => {
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    expect(screen.getByText("boutique:items")).toBeInTheDocument();
    expect(screen.getByText("boutique")).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
    expect(screen.getByText("number")).toBeInTheDocument();
    expect(screen.getByText("Unit price")).toBeInTheDocument();
  });

  it("preview button fetches rows without filters and renders them", async () => {
    previewDataSource.mockResolvedValue({
      ok: true,
      rows: [{ id: "sword", price: 10 }],
      truncated: true,
    });
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    fireEvent.click(await screen.findByTestId("server-source-preview"));
    await waitFor(() => expect(screen.getByText("sword")).toBeInTheDocument());
    expect(previewDataSource).toHaveBeenCalledWith("n1", "sk1", { ref: "boutique:items" });
    expect(screen.getByTestId("data-table-truncated")).toBeInTheDocument();
  });

  it("shows the typed error states", async () => {
    previewDataSource.mockResolvedValue({ ok: false, error: "player_required", message: null });
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    fireEvent.click(await screen.findByTestId("server-source-preview"));
    await waitFor(() => expect(screen.getByTestId("preview-error")).toBeInTheDocument());
  });

  it("disables preview with an explanation when the server is offline", async () => {
    getNetworkServersStatus.mockResolvedValue({
      servers: [{ id: "sk1", online: false }],
      online: 0,
      total: 1,
    });
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    await waitFor(() => expect(screen.getByTestId("server-source-preview")).toBeDisabled());
    expect(screen.getByTestId("preview-offline-hint")).toBeInTheDocument();
  });
});
