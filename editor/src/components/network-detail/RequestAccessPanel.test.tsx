import * as accessRequestsApi from "@/lib/api/accessRequests";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestAccessPanel } from "./RequestAccessPanel";

describe("RequestAccessPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(accessRequestsApi, "getAccessOptions").mockResolvedValue({
      mode: "invitation",
      isMember: false,
      command: null,
      servers: [],
    });
  });

  it("shows idle state with a request button", async () => {
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    expect(
      await screen.findByRole("button", { name: /request access|demander l.accès/i }),
    ).toBeInTheDocument();
  });

  it("shows the console command and opens access after authorization", async () => {
    const options = {
      mode: "console" as const,
      isMember: false,
      command: "artisan member add user@example.com",
      servers: [{ id: "s1", label: "Survival", online: true }],
    };
    vi.spyOn(accessRequestsApi, "getAccessOptions").mockResolvedValue(options);
    const granted = vi.fn();
    render(
      <RequestAccessPanel networkIdOrSlug="n1" onAccessGranted={granted} pollIntervalMs={20} />,
    );
    await screen.findByText(options.command);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Survival/)).toBeInTheDocument();
    vi.mocked(accessRequestsApi.getAccessOptions).mockResolvedValue({ ...options, isMember: true });
    await waitFor(() => expect(granted).toHaveBeenCalledOnce());
  });

  it("sends the request and shows confirmation", async () => {
    const spy = vi.spyOn(accessRequestsApi, "requestAccess").mockResolvedValue(undefined);
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /request access|demander l.accès/i }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", undefined));
    await screen.findByText(/request sent|demande envoyée/i);
  });

  it("sends an optional message with the request", async () => {
    const spy = vi.spyOn(accessRequestsApi, "requestAccess").mockResolvedValue(undefined);
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Please let me in" } });
    fireEvent.click(
      await screen.findByRole("button", { name: /request access|demander l.accès/i }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "Please let me in"));
  });

  it("shows already_pending state on 409 already_pending", async () => {
    vi.spyOn(accessRequestsApi, "requestAccess").mockRejectedValue(
      Object.assign(new Error("already_pending"), { status: 409 }),
    );
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /request access|demander l.accès/i }),
    );
    await screen.findByText(/already pending|déjà une demande/i);
  });

  it("shows an error state on unexpected failure", async () => {
    vi.spyOn(accessRequestsApi, "requestAccess").mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /request access|demander l.accès/i }),
    );
    await screen.findByText(/something went wrong|une erreur/i);
  });
});
