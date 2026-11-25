// @vitest-environment node
import { hashContent } from "@/lib/contentHash";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { saveThemeColors } from "./themeWrite";

const write = vi.fn();
vi.mock("@/lib/api/projectFiles", () => ({
  writeProjectFiles: (...args: unknown[]) => write(...args),
}));

const table = new Map([[0x3c8527, 0xb3261e]]);
const written = 'colors:\n  "#3c8527": "#b3261e"\n';

describe("a theme's colours written on the server", () => {
  beforeEach(() => {
    write.mockReset();
    write.mockResolvedValue({ ok: true });
  });

  test("a theme without a file gets one, checked against there being none", async () => {
    const theme = { projectId: "srv.noel", files: {}, binaries: [] };
    expect(await saveThemeColors(theme, table)).toBe(true);
    expect(write).toHaveBeenCalledWith("srv.noel", {
      files: [{ path: "overrides/colors.yml", content: written, base_hash: null }],
      deletes: [],
    });
  });

  test("its file is rewritten in place, its other keys kept, against the content read", async () => {
    const before = 'scope: guilds\ncolors:\n  "#a02824": "#102030"\n';
    const theme = {
      projectId: "srv.noel",
      files: { "overrides/colors.yaml": before },
      binaries: [],
    };
    expect(await saveThemeColors(theme, table)).toBe(true);
    expect(write).toHaveBeenCalledWith("srv.noel", {
      files: [
        {
          path: "overrides/colors.yaml",
          content: `scope: guilds\n${written}`,
          base_hash: await hashContent(before),
        },
      ],
      deletes: [],
    });
  });

  test("a file left with nothing is deleted, the same table writes nothing", async () => {
    const theme = {
      projectId: "srv.noel",
      files: { "overrides/colors.yml": written },
      binaries: [],
    };
    expect(await saveThemeColors(theme, table)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(await saveThemeColors(theme, new Map())).toBe(true);
    expect(write).toHaveBeenCalledWith("srv.noel", {
      files: [],
      deletes: [{ path: "overrides/colors.yml", base_hash: await hashContent(written) }],
    });
  });

  test("a refusal is thrown with its code", async () => {
    write.mockResolvedValue({ ok: false, error: "conflict", conflicts: [], diskFiles: [] });
    const theme = { projectId: "srv.noel", files: {}, binaries: [] };
    await expect(saveThemeColors(theme, table)).rejects.toThrow("conflict");
  });
});
