import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as accessRequestsApi from "@/lib/api/accessRequests";
import { RequestAccessPanel } from "./RequestAccessPanel";

describe("RequestAccessPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows idle state with a request button", () => {
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    expect(screen.getByRole("button", { name: /request access|demander l.accès/i })).toBeInTheDocument();
  });

  it("sends the request and shows confirmation", async () => {
    const spy = vi.spyOn(accessRequestsApi, "requestAccess").mockResolvedValue(undefined);
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.click(screen.getByRole("button", { name: /request access|demander l.accès/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", undefined));
    await screen.findByText(/request sent|demande envoyée/i);
  });

  it("sends an optional message with the request", async () => {
    const spy = vi.spyOn(accessRequestsApi, "requestAccess").mockResolvedValue(undefined);
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Please let me in" } });
    fireEvent.click(screen.getByRole("button", { name: /request access|demander l.accès/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "Please let me in"));
  });

  it("shows already_pending state on 409 already_pending", async () => {
    vi.spyOn(accessRequestsApi, "requestAccess").mockRejectedValue(
      Object.assign(new Error("already_pending"), { status: 409 }),
    );
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.click(screen.getByRole("button", { name: /request access|demander l.accès/i }));
    await screen.findByText(/already pending|déjà une demande/i);
  });

  it("shows an error state on unexpected failure", async () => {
    vi.spyOn(accessRequestsApi, "requestAccess").mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );
    render(<RequestAccessPanel networkIdOrSlug="n1" />);
    fireEvent.click(screen.getByRole("button", { name: /request access|demander l.accès/i }));
    await screen.findByText(/something went wrong|une erreur/i);
  });
});
