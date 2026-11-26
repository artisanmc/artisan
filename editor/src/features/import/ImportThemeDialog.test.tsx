import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportThemeDialog } from "./ImportThemeDialog";

const createProject = vi.fn();
const writeProjectFiles = vi.fn();
vi.mock("@/lib/api/servers", () => ({
  createProject: (...args: unknown[]) => createProject(...args),
}));
vi.mock("@/lib/api/projectFiles", () => ({
  writeProjectFiles: (...args: unknown[]) => writeProjectFiles(...args),
}));
vi.mock("@/lib/api/userProjects", () => ({ deleteUserProject: vi.fn(async () => undefined) }));

async function zipFile(name: string, files: Record<string, string | Uint8Array>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return new File([await zip.generateAsync({ type: "blob" })], name);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);

const pick = (file: File) =>
  fireEvent.change(screen.getByLabelText("Archive du thème"), { target: { files: [file] } });

describe("ImportThemeDialog", () => {
  beforeEach(() => {
    createProject.mockReset().mockResolvedValue({ id: "srv.noel" });
    writeProjectFiles.mockReset().mockResolvedValue({ ok: true });
  });

  it("reads the archive, proposes its name and imports the theme", async () => {
    const onImported = vi.fn();
    render(<ImportThemeDialog serverKeyId="srv" taken={["hiver"]} onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: "Importer un thème" }));
    // Nothing to import before an archive is read.
    expect(screen.getByRole("button", { name: "Importer" })).toBeDisabled();
    pick(
      await zipFile("noel.theme.zip", {
        "overrides/colors.yml": 'colors: {"#3c8527": "#b3261e"}\n',
        "overrides/artisan/close.1x1.png": PNG,
        "overrides/artisan/back.1x1.png": PNG,
      }),
    );
    expect(await screen.findByTestId("import-theme-holds")).toHaveTextContent("2 images.");
    const field = screen.getByLabelText("Nom du thème");
    expect(field).toHaveValue("noel");
    // A name the server has is refused before anything is sent.
    fireEvent.change(field, { target: { value: "hiver" } });
    expect(screen.getByRole("alert")).toHaveTextContent("porte déjà ce nom");
    expect(screen.getByRole("button", { name: "Importer" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "fetes" } });
    fireEvent.click(screen.getByRole("button", { name: "Importer" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("fetes"));
    expect(createProject).toHaveBeenCalledWith("srv", "fetes", "theme");
    expect(writeProjectFiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why an archive is no theme's, and why the server refused", async () => {
    render(<ImportThemeDialog serverKeyId="srv" onImported={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Importer un thème" }));
    pick(await zipFile("daily.zip", { "artisan-module.yml": "id: daily\n", "assets/a.png": PNG }));
    expect(await screen.findByRole("alert")).toHaveTextContent("celle d'un module");
    expect(screen.queryByLabelText("Nom du thème")).toBeNull();
    // Another archive replaces the first; its name is no theme's, so it is asked.
    pick(await zipFile("Mon thème.zip", { "overrides/colors.yml": "colors: {}\n" }));
    expect(await screen.findByTestId("import-theme-holds")).toHaveTextContent(
      "Aucune image : seulement des notes de dessin.",
    );
    expect(screen.getByLabelText("Nom du thème")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Nom du thème"), { target: { value: "noel" } });
    createProject.mockRejectedValue(new Error("server_offline"));
    fireEvent.click(screen.getByRole("button", { name: "Importer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Le serveur est hors ligne");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
