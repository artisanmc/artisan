import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";

afterEach(() => vi.unstubAllGlobals());

describe("NewProjectDialog", () => {
  it("submits Enter once and waits for the server before closing", async () => {
    const user = userEvent.setup();
    let finish!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const onCreated = vi.fn();
    render(<NewProjectDialog networkId="network" serverKeyId="server" onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: /nouveau projet/i }));
    await user.type(screen.getByPlaceholderText("mon_projet"), "mon_projet{Enter}{Enter}");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      name: "mon_projet",
      serverKeyId: "server",
    });
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () =>
      finish(new Response(JSON.stringify({ project: { id: "mon_projet" } }), { status: 201 })),
    );
    expect(onCreated).toHaveBeenCalledWith("mon_projet");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the name and shows a readable server error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "server_offline" }), { status: 503 })),
    );
    render(<NewProjectDialog networkId="network" serverKeyId="server" />);
    await user.click(screen.getByRole("button", { name: /nouveau projet/i }));
    await user.type(screen.getByRole("textbox"), "mon_projet{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/serveur.*hors ligne/i);
    expect(screen.getByRole("textbox")).toHaveValue("mon_projet");
  });
});
