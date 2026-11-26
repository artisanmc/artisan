import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importTheme, readThemeZip } from "./runImportTheme";

const createProject = vi.fn();
const writeProjectFiles = vi.fn();
const deleteUserProject = vi.fn();
vi.mock("@/lib/api/servers", () => ({
  createProject: (...args: unknown[]) => createProject(...args),
}));
vi.mock("@/lib/api/projectFiles", () => ({
  writeProjectFiles: (...args: unknown[]) => writeProjectFiles(...args),
}));
vi.mock("@/lib/api/userProjects", () => ({
  deleteUserProject: (...args: unknown[]) => deleteUserProject(...args),
}));

async function zipFile(name: string, files: Record<string, string | Uint8Array>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return new File([await zip.generateAsync({ type: "blob" })], name);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);

describe("a theme's import", () => {
  beforeEach(() => {
    createProject.mockReset().mockResolvedValue({ id: "srv.noel" });
    writeProjectFiles.mockReset().mockResolvedValue({ ok: true });
    deleteUserProject.mockReset().mockResolvedValue(undefined);
  });

  it("reads the theme's files and its name from the archive", async () => {
    const read = await readThemeZip(
      await zipFile("noel.theme.zip", {
        "overrides/colors.yml": 'colors: {"#3c8527": "#b3261e"}\n',
        "overrides/artisan/close.1x1.png": PNG,
      }),
    );
    expect(read).toEqual({
      ok: true,
      name: "noel",
      archive: {
        files: { "overrides/colors.yml": 'colors: {"#3c8527": "#b3261e"}\n' },
        binaries: { "overrides/artisan/close.1x1.png": PNG },
      },
    });
    // A file that is no zip, and a module's archive, are told apart.
    expect(await readThemeZip(new File(["not a zip"], "noel.theme.zip"))).toEqual({
      ok: false,
      error: "not_a_zip",
    });
    expect(
      await readThemeZip(await zipFile("daily.zip", { "artisan-module.yml": "id: daily\n" })),
    ).toEqual({ ok: false, error: "not_a_theme" });
    expect(
      await readThemeZip(
        await zipFile("daily.zip", { "artisan-module.yml": "id: daily\n", "assets/a.png": PNG }),
      ),
    ).toEqual({ ok: false, error: "is_module" });
  });

  it("creates the theme's folder, then writes its files there", async () => {
    await importTheme("srv", "noel", {
      files: { "overrides/colors.yml": "colors: {}\n" },
      binaries: { "overrides/artisan/close.1x1.png": PNG },
    });
    expect(createProject).toHaveBeenCalledWith("srv", "noel", "theme");
    expect(writeProjectFiles).toHaveBeenCalledTimes(1);
    const [target, plan] = writeProjectFiles.mock.calls[0] as [string, Record<string, unknown>];
    expect(target).toBe("srv.noel");
    expect(plan.files).toEqual([
      { path: "overrides/colors.yml", content: "colors: {}\n", base_hash: null },
    ]);
    expect(plan.binaries).toEqual([
      {
        path: "overrides/artisan/close.1x1.png",
        content_base64: btoa(String.fromCharCode(...PNG)),
        base_hash: null,
      },
    ]);
    expect(plan.deletes).toEqual([]);
    expect(plan.operationId).toMatch(/^[a-zA-Z0-9_-]{1,100}$/);
    expect(deleteUserProject).not.toHaveBeenCalled();
  });

  it("takes the folder off again when a write is refused, and says why", async () => {
    writeProjectFiles.mockResolvedValue({ ok: false, error: "server_offline" });
    await expect(
      importTheme("srv", "noel", { files: { "overrides/colors.yml": "x" }, binaries: {} }),
    ).rejects.toThrow("server_offline");
    expect(deleteUserProject).toHaveBeenCalledWith("srv.noel");
    // A name already taken is refused before anything is written.
    createProject.mockRejectedValue(new Error("project_exists"));
    writeProjectFiles.mockClear();
    await expect(importTheme("srv", "noel", { files: {}, binaries: {} })).rejects.toThrow(
      "project_exists",
    );
    expect(writeProjectFiles).not.toHaveBeenCalled();
  });
});
