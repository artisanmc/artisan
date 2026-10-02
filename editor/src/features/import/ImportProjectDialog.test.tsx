import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareImportZip: vi.fn(),
  applyImportZip: vi.fn(),
}));

vi.mock("./runImportZip", () => ({
  prepareImportZip: mocks.prepareImportZip,
  applyImportZip: mocks.applyImportZip,
}));

import { ImportProjectDialog } from "./ImportProjectDialog";

const target = { networkId: "n1", serverId: "sk1" };
const basePreview = {
  target,
  projectId: "shop",
  exists: false,
  mode: "merge" as const,
  input: { files: { "menus/a.yaml": "import\n" }, binaries: {} },
  reference: { files: {}, binaries: {} },
};

function pickFile() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  fireEvent.change(input, { target: { files: [new File(["zip"], "p.zip")] } });
}

describe("ImportProjectDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applique directement un import sans conflit", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        diff: { additions: ["manifest.yaml"], identical: [], conflicts: [], serverOnly: [] },
      },
    });
    mocks.applyImportZip.mockResolvedValue({
      ok: true,
      projectId: "shop",
      created: true,
      conflicts: 0,
    });
    const onImported = vi.fn();

    render(
      <ImportProjectDialog
        networkId="n1"
        serverKeyId="sk1"
        open
        onClose={() => {}}
        onImported={onImported}
      />,
    );
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(mocks.applyImportZip).toHaveBeenCalledWith(expect.anything(), {}));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("shop", true));
  });

  it("tranche les conflits fichier par fichier", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        diff: {
          additions: [],
          identical: [],
          serverOnly: [],
          conflicts: [
            { path: "menus/a.yaml", kind: "text", server: "server\n", serverBinary: null },
          ],
        },
      },
    });
    mocks.applyImportZip.mockResolvedValue({
      ok: true,
      projectId: "shop",
      created: false,
      conflicts: 1,
    });

    render(<ImportProjectDialog networkId="n1" serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    const keepServer = await screen.findByRole("button", {
      name: /garder le serveur|keep server/i,
    });
    fireEvent.click(keepServer);
    fireEvent.click(screen.getByRole("button", { name: /appliqu|apply/i }));

    await waitFor(() =>
      expect(mocks.applyImportZip).toHaveBeenCalledWith(expect.anything(), {
        "menus/a.yaml": "server",
      }),
    );
  });

  it("en écrasement, confirme sans demander de choix et applique sans choix", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        mode: "overwrite",
        diff: {
          additions: [],
          identical: [],
          serverOnly: [],
          conflicts: [
            { path: "menus/a.yaml", kind: "text", server: "server\n", serverBinary: null },
          ],
        },
      },
    });
    mocks.applyImportZip.mockResolvedValue({
      ok: true,
      projectId: "shop",
      created: false,
      conflicts: 1,
    });

    render(<ImportProjectDialog networkId="n1" serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    const apply = await screen.findByRole("button", { name: /appliqu|apply/i });
    expect(screen.queryByRole("button", { name: /garder le serveur|keep server/i })).toBeNull();
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() => expect(mocks.applyImportZip).toHaveBeenCalledWith(expect.anything(), {}));
  });

  it("en écrasement, fait confirmer la suppression des fichiers absents de l'archive", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        mode: "overwrite",
        diff: { additions: [], identical: [], conflicts: [], serverOnly: ["menus/old.yaml"] },
      },
    });

    render(<ImportProjectDialog networkId="n1" serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    expect(await screen.findByText("menus/old.yaml")).toBeInTheDocument();
    expect(mocks.applyImportZip).not.toHaveBeenCalled();
  });
});
