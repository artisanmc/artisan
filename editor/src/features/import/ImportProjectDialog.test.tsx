import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
