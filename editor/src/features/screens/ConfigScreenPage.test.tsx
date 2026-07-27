import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configRead = vi.fn();
const configWrite = vi.fn();
vi.mock("@/lib/api/configScreens", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, configRead: (...a: unknown[]) => configRead(...a), configWrite: (...a: unknown[]) => configWrite(...a) };
});
vi.mock("@/lib/api/dataSources", () => ({ fetchServerDeclaredModels: vi.fn(async () => []) }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));

import { useServerScreensStore } from "@/state/serverScreensStore";
import { ConfigScreenPage } from "./ConfigScreenPage";

const SETTINGS = "whole_shop_discount: 10\n";

beforeEach(() => {
  vi.clearAllMocks();
  configRead.mockImplementation(async (_n: string, _s: string, req: { table: string }) =>
    req.table === "data/shop_settings"
      ? { ok: true, files: [{ path: "data/shop_settings.yaml", content: SETTINGS }] }
      : { ok: true, files: [] },
  );
  configWrite.mockResolvedValue({ ok: true });
  useServerScreensStore.setState({
    screens: [
      {
        id: "boutique:settings",
        moduleId: "boutique",
        label: "Réglages",
        table: "data/shop_settings",
        projectId: "boutique_shop",
      },
    ],
  } as never);
});

const renderPage = () =>
  render(<ConfigScreenPage networkId="n" serverId="s" screenId="boutique:settings" />);

async function ready() {
  await waitFor(() => expect(screen.getByTestId("config-value-form")).toBeTruthy());
}

describe("ConfigScreenPage — form and YAML over the same file", () => {
  it("shows the generated form by default", async () => {
    renderPage();
    await ready();
    expect(screen.getByDisplayValue("10")).toBeTruthy();
  });

  it("switches to the raw YAML of the file being edited", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /YAML/i }));
    expect((screen.getByLabelText("data/shop_settings.yaml") as HTMLTextAreaElement).value)
      .toContain("whole_shop_discount: 10");
  });

  // ⑦: a text edit is canonicalized on save — it goes through parse → domain →
  // writer, exactly like a form edit.
  it("saves a YAML edit through the canonical writer", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /YAML/i }));
    fireEvent.change(screen.getByLabelText("data/shop_settings.yaml"), {
      target: { value: "whole_shop_discount: 42\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    const written = configWrite.mock.calls[0]![2] as { files: { path: string; content: string }[] };
    const file = written.files.find((f) => f.path === "data/shop_settings.yaml")!;
    expect(file.content).toContain("42");
  });

  // ⑦: invalid YAML disables the form (it cannot exist) but never blocks the
  // save — it is the admin's file.
  it("disables the form on invalid YAML yet still allows saving", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /YAML/i }));
    fireEvent.change(screen.getByLabelText("data/shop_settings.yaml"), {
      target: { value: "whole_shop_discount: [unclosed\n" },
    });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Formulaire/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enregistrer/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(configWrite).toHaveBeenCalled());
    const written = configWrite.mock.calls[0]![2] as { files: { path: string; content: string }[] };
    expect(written.files[0]!.content).toContain("[unclosed");
  });
});
