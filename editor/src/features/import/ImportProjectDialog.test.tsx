import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareImportZip: vi.fn(),
  applyImportZip: vi.fn(),
}));

vi.mock("./runImportZip", async (importOriginal) => ({
  lacksElsewhere: (await importOriginal<typeof import("./runImportZip")>()).lacksElsewhere,
  prepareImportZip: mocks.prepareImportZip,
  applyImportZip: mocks.applyImportZip,
}));

import { ImportProjectDialog } from "./ImportProjectDialog";

const target = { serverId: "sk1" };
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

  it("applies an import without conflicts directly", async () => {
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
      <ImportProjectDialog serverKeyId="sk1" open onClose={() => {}} onImported={onImported} />,
    );
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(mocks.applyImportZip).toHaveBeenCalledWith(expect.anything(), {}));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("shop", true));
  });

  it("settles the conflicts file by file", async () => {
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

    render(<ImportProjectDialog serverKeyId="sk1" open onClose={() => {}} />);
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

  it("in overwrite mode, confirms without asking for choices and applies without choices", async () => {
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

    render(<ImportProjectDialog serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    const apply = await screen.findByRole("button", { name: /appliqu|apply/i });
    expect(screen.queryByRole("button", { name: /garder le serveur|keep server/i })).toBeNull();
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() => expect(mocks.applyImportZip).toHaveBeenCalledWith(expect.anything(), {}));
  });

  it("in overwrite mode, asks to confirm deleting the files missing from the archive", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        mode: "overwrite",
        diff: { additions: [], identical: [], conflicts: [], serverOnly: ["menus/old.yaml"] },
      },
    });

    render(<ImportProjectDialog serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    expect(await screen.findByText("menus/old.yaml")).toBeInTheDocument();
    expect(mocks.applyImportZip).not.toHaveBeenCalled();
  });

  it("says what the server lacks of the images the module names before applying", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        diff: { additions: ["menus/a.yaml"], identical: [], conflicts: [], serverOnly: [] },
        elsewhere: {
          dropped: ["frame"],
          kept: ["blason"],
          artisan: "1.4.0",
          base: ["medal.1x1"],
          common: [],
          modules: [{ folder: "guilds", images: ["crest"], absent: true }],
        },
      },
    });
    mocks.applyImportZip.mockResolvedValue({
      ok: true,
      projectId: "shop",
      created: true,
      conflicts: 0,
    });
    render(<ImportProjectDialog serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    const notice = await screen.findByTestId("import-elsewhere");
    expect(mocks.applyImportZip).not.toHaveBeenCalled();
    expect(notice.textContent).toContain("medal.1x1");
    expect(notice.textContent).toContain("1.4.0");
    expect(notice.textContent).toContain("guilds");
    expect(notice.textContent).toContain("frame");
    expect(notice.textContent).toContain("blason");
    fireEvent.click(screen.getByRole("button", { name: /appliqu|apply/i }));
    await waitFor(() => expect(mocks.applyImportZip).toHaveBeenCalledWith(expect.anything(), {}));
  });

  it("applies directly when the copies are settled and the server lacks nothing", async () => {
    mocks.prepareImportZip.mockResolvedValue({
      ok: true,
      preview: {
        ...basePreview,
        diff: { additions: ["menus/a.yaml"], identical: [], conflicts: [], serverOnly: [] },
        elsewhere: {
          dropped: ["frame"],
          kept: [],
          artisan: null,
          base: [],
          common: [],
          modules: [],
        },
      },
    });
    mocks.applyImportZip.mockResolvedValue({
      ok: true,
      projectId: "shop",
      created: true,
      conflicts: 0,
    });
    render(<ImportProjectDialog serverKeyId="sk1" open onClose={() => {}} />);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: /^import/i }));
    await waitFor(() => expect(mocks.applyImportZip).toHaveBeenCalled());
  });
});
