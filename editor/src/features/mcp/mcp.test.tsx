import { ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/state/authStore";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantAlwaysSection } from "./AssistantAlwaysSection";
import { ConsentPage, consentParams } from "./ConsentPage";
import { McpAppsSection } from "./McpAppsSection";

const api = vi.hoisted(() => ({
  getConsent: vi.fn(),
  answerConsent: vi.fn(),
  listMcpGrants: vi.fn(),
  revokeMcpGrant: vi.fn(),
  setMcpGrantPublish: vi.fn(),
  setMcpGrantImages: vi.fn(),
}));
const ai = vi.hoisted(() => ({ getAiPermissions: vi.fn(), revokeAiPermission: vi.fn() }));
vi.mock("@/lib/api/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/ai")>()),
  ...ai,
}));
vi.mock("@/lib/api/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/mcp")>()),
  ...api,
}));

const query = `?client_id=mcp_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1&code_challenge=${"c".repeat(43)}`;

const signIn = (permissions: string[]) =>
  useAuthStore.setState({
    currentUser: { id: "u1", name: "Iban", permissions } as never,
    isLoading: false,
  });

describe("consent page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ currentUser: null, isLoading: false });
  });

  it("reads the client's request from the address, and refuses an incomplete one", () => {
    expect(consentParams(new URLSearchParams(query))).toEqual({
      client_id: "mcp_1",
      redirect_uri: "https://claude.ai/cb",
      state: "s1",
      code_challenge: "c".repeat(43),
    });
    expect(consentParams(new URLSearchParams("?error=invalid_client"))).toBeNull();
    expect(consentParams(new URLSearchParams("?client_id=x"))).toBeNull();
  });

  it("asks a signed-out player to sign in first", () => {
    render(<ConsentPage query={query} />);
    expect(screen.getByText(/artisan editor/)).toBeInTheDocument();
    expect(api.getConsent).not.toHaveBeenCalled();
  });

  it("names the client and sends the player back with the answer", async () => {
    signIn(["artisan.editor.view", "artisan.editor.edit"]);
    api.getConsent.mockResolvedValue({
      client: { name: "Claude", redirectHost: "claude.ai" },
      player: "Iban",
      canEdit: true,
      canPublish: false,
    });
    api.answerConsent.mockResolvedValue("https://claude.ai/cb?code=abc&state=s1");
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign },
      writable: true,
    });
    render(<ConsentPage query={query} />);
    const allow = await screen.findByRole("button", { name: /Allow|Autoriser/ });
    fireEvent.click(allow);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=abc&state=s1"),
    );
    expect(api.answerConsent).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "mcp_1" }),
      true,
      false,
      false,
    );
    // A player who cannot deploy is not offered to let the client deploy.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("lets a client deploy only when the player ticks it", async () => {
    signIn(["artisan.editor.view", "artisan.editor.edit", "artisan.editor.publish"]);
    api.getConsent.mockResolvedValue({
      client: { name: "Claude", redirectHost: "claude.ai" },
      player: "Iban",
      canEdit: true,
      canPublish: true,
    });
    api.answerConsent.mockResolvedValue("https://claude.ai/cb?code=abc");
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: vi.fn() },
      writable: true,
    });
    render(<ConsentPage query={query} />);
    const box = await screen.findByRole("checkbox");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /Allow|Autoriser/ }));
    await waitFor(() =>
      expect(api.answerConsent).toHaveBeenCalledWith(expect.anything(), true, true, false),
    );
  });

  it("lets a client ask the server's image model only when the player ticks it", async () => {
    signIn(["artisan.editor.view", "artisan.editor.edit"]);
    api.getConsent.mockResolvedValue({
      client: { name: "Claude", redirectHost: "claude.ai" },
      player: "Iban",
      canEdit: true,
      canPublish: false,
      canImages: true,
    });
    api.answerConsent.mockResolvedValue("https://claude.ai/cb?code=abc");
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: vi.fn() },
      writable: true,
    });
    render(<ConsentPage query={query} />);
    // The only box here: this player cannot deploy. It says who pays.
    const box = await screen.findByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(screen.getByText(/paid by the server's owner|payée par le propriétaire/)).toBeTruthy();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /Allow|Autoriser/ }));
    await waitFor(() =>
      expect(api.answerConsent).toHaveBeenCalledWith(expect.anything(), true, false, true),
    );
  });

  it("cannot be approved without artisan.editor.edit", async () => {
    signIn(["artisan.editor.view"]);
    api.getConsent.mockResolvedValue({
      client: { name: "Claude", redirectHost: "claude.ai" },
      player: "Iban",
      canEdit: false,
      canPublish: false,
    });
    render(<ConsentPage query={query} />);
    expect(await screen.findByRole("button", { name: /Allow|Autoriser/ })).toBeDisabled();
  });
});

describe("AI apps settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the connected clients and disconnects one", async () => {
    api.listMcpGrants.mockResolvedValue({
      grants: [
        {
          id: "g1",
          client: "Claude",
          createdAt: "2026-10-25T10:00:00Z",
          lastUsedAt: "2026-10-25T11:00:00Z",
          publish: false,
        },
      ],
      canPublish: true,
    });
    api.revokeMcpGrant.mockResolvedValue(undefined);
    render(<McpAppsSection />);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Disconnect|Déconnecter/ }));
    await waitFor(() => expect(screen.queryByText("Claude")).not.toBeInTheDocument());
    expect(api.revokeMcpGrant).toHaveBeenCalledWith("g1");
  });

  it("switches a client's right to deploy", async () => {
    api.listMcpGrants.mockResolvedValue({
      grants: [
        {
          id: "g1",
          client: "Claude",
          createdAt: "2026-10-25T10:00:00Z",
          lastUsedAt: "2026-10-25T11:00:00Z",
          publish: false,
        },
      ],
      canPublish: true,
    });
    api.setMcpGrantPublish.mockResolvedValue(undefined);
    render(<McpAppsSection />);
    const toggle = await screen.findByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(api.setMcpGrantPublish).toHaveBeenCalledWith("g1", true);
  });

  it("switches a client's right to the server's image model, where there is one", async () => {
    api.listMcpGrants.mockResolvedValue({
      grants: [
        {
          id: "g1",
          client: "Claude",
          createdAt: "2026-10-25T10:00:00Z",
          lastUsedAt: "2026-10-25T11:00:00Z",
          publish: false,
          images: false,
        },
      ],
      canPublish: true,
      canImages: true,
    });
    api.setMcpGrantImages.mockResolvedValue(undefined);
    render(<McpAppsSection />);
    const toggle = await screen.findByRole("switch", {
      name: /Can generate pictures|Peut générer des images/,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(api.setMcpGrantImages).toHaveBeenCalledWith("g1", true);
    expect(api.setMcpGrantPublish).not.toHaveBeenCalled();
  });

  it("shows what the assistant is always allowed, and takes it back", async () => {
    ai.getAiPermissions.mockResolvedValue(["generate_image"]);
    ai.revokeAiPermission.mockResolvedValue([]);
    render(<AssistantAlwaysSection />);
    expect(await screen.findByTestId("assistant-always")).toBeInTheDocument();
    expect(screen.getByText(/generate a picture|générer une image/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ask again|Redemander/ }));
    await waitFor(() => expect(screen.queryByTestId("assistant-always")).not.toBeInTheDocument());
    expect(ai.revokeAiPermission).toHaveBeenCalledWith("generate_image");
  });

  it("shows nothing of the assistant while nothing is always allowed", async () => {
    ai.getAiPermissions.mockRejectedValue(new ApiError("not_found", 404));
    const { container } = render(<AssistantAlwaysSection />);
    await waitFor(() => expect(ai.getAiPermissions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("says when the server has the MCP endpoint off", async () => {
    api.listMcpGrants.mockRejectedValue(new ApiError("not_found", 404));
    render(<McpAppsSection />);
    expect(await screen.findByText(/web\.mcp/)).toBeInTheDocument();
  });
});
