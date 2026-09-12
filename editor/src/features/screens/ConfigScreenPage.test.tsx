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
vi.mock("@/lib/api/projectFiles", () => ({ readProjectFiles: vi.fn(async () => ({ ok: true, files: {} })) }));
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
import { ConfigScreenPage } from "./ConfigScreenPage";
import { getModule } from "@artisan/editor-sdk";

const SETTINGS = "whole_shop_discount: 10\n";

beforeEach(() => {
  vi.clearAllMocks();
  useScreenCacheStore.setState({ entries: {} } as never);
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

/**
 * Ces écrans lisaient le serveur à CHAQUE ouverture — trois allers-retours — et
 * restaient vides pendant ce temps, pour un contenu presque toujours identique
 * à la visite d'avant.
 *
 * Ils affichent donc la dernière version connue tout de suite. Mais un écran de
 * Config édite les fichiers du serveur en direct : tant que la revalidation n'a
 * pas répondu, ce qui est à l'écran est DATÉ, et enregistrer dessus ferait
 * partir un compare-and-swap sur une base fausse. On montre, on annonce, on
 * n'ouvre l'édition qu'après.
 */
describe("ConfigScreenPage — dernière version connue", () => {
  it("affiche le connu sans attendre le serveur, et le dit", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("n", "s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });
    // Le serveur ne répond jamais : si l'écran l'attend, il reste vide.
    configRead.mockReturnValue(new Promise(() => {}));

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("42")).toBeTruthy());
    // Le contenu est là tout de suite, et RIEN ne clignote : une revalidation
    // qui aboutit — même en une seconde et demie — n'a rien à signaler.
    expect(screen.queryByTestId("screen-stale-banner")).toBeNull();
  });

  /**
   * Le cas qui compte vraiment : la revalidation échoue. L'écran reste daté
   * sans terme et l'édition reste fermée — sans avis, rien n'expliquerait
   * pourquoi on ne peut plus enregistrer.
   */
  it("un échec de revalidation se dit tout de suite", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("n", "s", "boutique:settings"), {
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

  it("n'ouvre pas l'enregistrement tant que la copie est datée", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("n", "s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });
    configRead.mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => expect(screen.getByDisplayValue("42")).toBeTruthy());

    // Écrire depuis une base datée, c'est écraser ce qui a changé entre-temps.
    expect(screen.queryByRole("button", { name: /Enregistr/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Recharger/ })).toBeNull();
  });

  it("la réponse du serveur remplace le connu et rend la main", async () => {
    useScreenCacheStore.getState().put(screenCacheKey("n", "s", "boutique:settings"), {
      files: [{ path: "data/shop_settings.yaml", content: "whole_shop_discount: 42\n" }],
      models: [],
      fetchedAt: new Date().toISOString(),
    });

    renderPage();

    await waitFor(() => expect(screen.getByDisplayValue("10")).toBeTruthy());
    expect(screen.queryByTestId("screen-stale-banner")).toBeNull();
    // Revalidé : l'édition s'ouvre.
    expect(screen.getByRole("button", { name: /Enregistr/ })).toBeTruthy();
  });

  it("ce que le serveur a rendu devient la version connue", async () => {
    renderPage();
    await ready();
    await waitFor(() =>
      expect(
        useScreenCacheStore.getState().get(screenCacheKey("n", "s", "boutique:settings"))?.files,
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
    configRead.mockImplementation(async (_n: string, _s: string, req: { table: string }) =>
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
