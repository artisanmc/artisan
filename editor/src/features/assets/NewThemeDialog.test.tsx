import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewThemeDialog } from "./NewThemeDialog";

afterEach(() => vi.unstubAllGlobals());

describe("NewThemeDialog", () => {
  it("creates a theme's folder on the server, then hands its name on", async () => {
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
    render(<NewThemeDialog serverKeyId="server" onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: /nouveau thème/i }));
    await user.type(screen.getByRole("textbox"), "noel{Enter}{Enter}");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toMatch(/\/api\/v1\/servers\/server\/projects$/);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      name: "noel",
      role: "theme",
    });
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () =>
      finish(new Response(JSON.stringify({ project: { id: "server.noel" } }), { status: 201 })),
    );
    expect(onCreated).toHaveBeenCalledWith("noel");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses a name no theme can have, or one taken, before asking the server", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    render(<NewThemeDialog serverKeyId="server" taken={["hiver"]} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: /nouveau thème/i }));
    const input = screen.getByRole("textbox");
    for (const name of ["Noel", "artisan", "a b"]) {
      await user.clear(input);
      await user.type(input, `${name}{Enter}`);
      expect(screen.getByRole("alert")).toHaveTextContent(/minuscules/i);
    }
    await user.clear(input);
    await user.type(input, "hiver{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/porte déjà ce nom/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the name and says why the server refused", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "plugin_update_required" }), { status: 501 }),
      ),
    );
    render(<NewThemeDialog serverKeyId="server" onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: /nouveau thème/i }));
    await user.type(screen.getByRole("textbox"), "noel{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/plus ancienne d'Artisan/i);
    expect(screen.getByRole("textbox")).toHaveValue("noel");
  });
});
