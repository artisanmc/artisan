import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configRead = vi.fn();
const configWrite = vi.fn();
vi.mock("@/lib/api/configScreens", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    configRead: (...a: unknown[]) => configRead(...a),
    configWrite: (...a: unknown[]) => configWrite(...a),
  };
});
vi.mock("@/lib/api/dataSources", () => ({ fetchServerDeclaredModels: vi.fn(async () => []) }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/lib/api/projectFiles", () => ({
  readProjectFiles: vi.fn(async () => ({ ok: true, files: {} })),
}));
// The page is what's under test, not CodeMirror: a textarea stands in for the
// shared YAML editor so edits can be simulated.
vi.mock("@/components/ui/yaml-code-editor", () => ({
  YamlCodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { screenCacheKey, useScreenCacheStore } from "@/state/screenCacheStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { getModule } from "@artisan/editor-sdk";
import { ConfigScreenPage } from "./ConfigScreenPage";

const SETTINGS = "whole_shop_discount: 10\n";

beforeEach(() => {
  vi.clearAllMocks();
  useScreenCacheStore.setState({ entries: {} } as never);
  configRead.mockImplementation(async (_s: string, req: { table: string }) =>
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

const renderPage = () => render(<ConfigScreenPage serverId="s" screenId="boutique:settings" />);

async function ready() {
  await waitFor(() => expect(screen.getByTestId("config-value-form")).toBeTruthy());
}

/**
 * These screens read the server on EVERY open — three round trips — and
 * stayed empty meanwhile, for content almost always identical to the previous
 * visit.
 *
 * So they show the last known version right away. But a Config screen edits
 * the server's files live: until revalidation answers, what is on screen is
 * DATED, and saving on it would send a compare-and-swap on a wrong base. Show,
 * announce, and only open editing afterwards.
 */
describe("ConfigScreenPage — last known version", () => {
  it("shows the known version without waiting for the server, and says so", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });
    // The server never answers: if the screen waits for it, it stays empty.
    configRead.mockReturnValue(new Promise(() => {}));

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("42")).toBeTruthy());
    // The content is there right away, and NOTHING flickers: a revalidation that
    // succeeds — even in a second and a half — has nothing to report.
    expect(screen.queryByTestId("screen-stale-banner")).toBeNull();
  });

  /**
   * The case that really matters: revalidation fails. The screen stays dated
   * indefinitely and editing stays closed — without a notice, nothing would
   * explain why saving is no longer possible.
   */
  it("a revalidation failure is reported right away", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });
    configRead.mockResolvedValue({ ok: false, error: "server_offline" });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("screen-stale-banner")).toBeTruthy());
    expect(screen.getByDisplayValue("42")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enregistr/ })).toBeNull();
  });

  it("does not enable saving while the copy is dated", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });
    configRead.mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("42")).toBeTruthy());

    // Writing from a dated base overwrites what changed meanwhile.
    expect(screen.queryByRole("button", { name: /Enregistr/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Recharger/ })).toBeNull();
  });

  it("the server's response replaces the known version and hands control back", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("10")).toBeTruthy());
    expect(screen.queryByTestId("screen-stale-banner")).toBeNull();
    // Revalidated: editing opens.
    expect(screen.getByRole("button", { name: /Enregistr/ })).toBeTruthy();
  });

  it("what the server returned becomes the known version", async () => {
    renderPage();
    await ready();
    await waitFor(() =>
      expect(
        useScreenCacheStore.getState().get(screenCacheKey("s", "boutique:settings"))?.files,
      ).toEqual([{ path: "data/shop_settings.yaml", content: SETTINGS }]),
    );
  });
});

describe("ConfigScreenPage — form and YAML over the same file", () => {
  it("loads the screen module before building its editable project", async () => {
    renderPage();
    await ready();
    expect(getModule("boutique")?.migrateProject).toBeTypeOf("function");
  });
  it("shows the generated form by default", async () => {
    renderPage();
    await ready();
    expect(screen.getByDisplayValue("10")).toBeTruthy();
  });

  it("switches to the raw YAML of the file being edited", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /YAML/i }));
    expect(
      (screen.getByLabelText("data/shop_settings.yaml") as HTMLTextAreaElement).value,
    ).toContain("whole_shop_discount: 10");
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
    const written = configWrite.mock.calls[0]![1] as { files: { path: string; content: string }[] };
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
    const written = configWrite.mock.calls[0]![1] as { files: { path: string; content: string }[] };
    expect(written.files[0]!.content).toContain("[unclosed");
  });
});

// Opening a screen must not show a rewrite as if it were the file: a legacy
// file (verbose data/v1 form) is displayed AS IT IS ON DISK. The canonical
// rewrite happens when the admin actually saves, not when they look.
describe("ConfigScreenPage — the YAML tab shows the file, not a pending rewrite", () => {
  const LEGACY = [
    "schema: data/v1",
    "id: shop_settings",
    "shape: config",
    "fields:",
    "  - name: whole_shop_discount",
    "    kind: integer",
    "value:",
    "  whole_shop_discount: 10",
    "",
  ].join("\n");

  beforeEach(() => {
    configRead.mockImplementation(async (_s: string, req: { table: string }) =>
      req.table === "data/shop_settings"
        ? { ok: true, files: [{ path: "data/shop_settings.yaml", content: LEGACY }] }
        : { ok: true, files: [] },
    );
  });

  it("displays the on-disk content, legacy shape included", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("config-value-form")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /YAML/i }));
    const shown = (screen.getByLabelText("data/shop_settings.yaml") as HTMLTextAreaElement).value;
    expect(shown).toBe(LEGACY);
  });

  it("is not dirty on open — looking at a file changes nothing", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("config-value-form")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Enregistré|Enregistrer/ })).toBeDisabled();
  });

  it("shows the canonical rewrite once the admin actually edits", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("config-value-form")).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue("10"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /YAML/i }));
    const shown = (screen.getByLabelText("data/shop_settings.yaml") as HTMLTextAreaElement).value;
    expect(shown).toContain("30");
    expect(shown).not.toContain("shape: config");
  });
});
