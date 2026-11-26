import { describe, expect, test } from "vitest";
import {
  THEME_ARCHIVE_MAX_BYTES,
  themeArchiveBatches,
  themeArchiveFiles,
  themeArchiveName,
  themeNameFromArchive,
} from "./themeArchive";

const png = (size = 3) => new Uint8Array(size).fill(7);

describe("a theme's archive", () => {
  test("its name gives the theme's, a browser's copy included", () => {
    expect(themeArchiveName("noel")).toBe("noel.theme.zip");
    expect(themeNameFromArchive("noel.theme.zip")).toBe("noel");
    expect(themeNameFromArchive("noel.theme (2).zip")).toBe("noel");
    expect(themeNameFromArchive("noel.theme.zip (1).zip")).toBeUndefined();
    expect(themeNameFromArchive("C:\\dl\\Noel (1).zip")).toBe("noel");
    expect(themeNameFromArchive("mon thème.zip")).toBeUndefined();
    // The common images' name is no theme's to take.
    expect(themeNameFromArchive("artisan.theme.zip")).toBeUndefined();
  });

  test("the theme's folders are kept, at the top or in the folder that wraps them", () => {
    const flat = themeArchiveFiles({
      "overrides/colors.yml": "colors: {}\n",
      "overrides/artisan/close.1x1.png": png(),
      "overrides/guilds/assets/banner.png": png(),
      "assets/textures/star.png": png(),
      "data/notes.yml": "notes: []\n",
      "readme.txt": "left out",
      ".artisan/editor.yaml": "left out",
    });
    expect(flat).toEqual({
      files: { "overrides/colors.yml": "colors: {}\n", "data/notes.yml": "notes: []\n" },
      binaries: {
        "overrides/artisan/close.1x1.png": png(),
        "overrides/guilds/assets/banner.png": png(),
        "assets/textures/star.png": png(),
      },
    });
    const wrapped = themeArchiveFiles({
      "themes/noel/overrides/colors.yml": "colors: {}\n",
      "themes/noel/assets/textures/star.png": png(),
      "themes/readme.txt": "left out",
    });
    expect(wrapped).toEqual({
      files: { "overrides/colors.yml": "colors: {}\n" },
      binaries: { "assets/textures/star.png": png() },
    });
  });

  test("a module's archive, one with no theme file, several themes and a heavy one are refused", () => {
    expect(
      themeArchiveFiles({ "artisan-module.yml": "id: daily\n", "assets/textures/a.png": png() }),
    ).toBe("is_module");
    expect(
      themeArchiveFiles({
        "daily/artisan-module.yml": "id: daily\n",
        "daily/assets/textures/a.png": png(),
      }),
    ).toBe("is_module");
    expect(themeArchiveFiles({ "menus/shop.yml": "id: shop\n" })).toBe("not_a_theme");
    expect(themeArchiveFiles({})).toBe("not_a_theme");
    // A path that leaves the folder is not read at all.
    expect(themeArchiveFiles({ "overrides/../../config.yml": "x" })).toBe("not_a_theme");
    expect(
      themeArchiveFiles({
        "noel/overrides/colors.yml": "colors: {}\n",
        "hiver/overrides/colors.yml": "colors: {}\n",
      }),
    ).toBe("not_a_theme");
    expect(themeArchiveFiles({ "assets/textures/big.png": png(THEME_ARCHIVE_MAX_BYTES + 1) })).toBe(
      "too_large",
    );
  });

  test("the images go in batches of a bounded weight, the text files with the first", () => {
    const archive = {
      files: { "overrides/colors.yml": "colors: {}\n" },
      binaries: { "assets/c.png": png(6), "assets/a.png": png(6), "assets/b.png": png(6) },
    };
    const batches = themeArchiveBatches(archive, 12);
    expect(batches.map((batch) => Object.keys(batch.binaries))).toEqual([
      ["assets/a.png", "assets/b.png"],
      ["assets/c.png"],
    ]);
    expect(batches[0]?.files).toEqual(archive.files);
    expect(batches[1]?.files).toEqual({});
    // A theme of colours alone is one write.
    expect(themeArchiveBatches({ files: archive.files, binaries: {} })).toEqual([
      { files: archive.files, binaries: {} },
    ]);
    // An image heavier than a batch goes alone.
    expect(
      themeArchiveBatches({ files: {}, binaries: { "assets/a.png": png(20) } }, 12).length,
    ).toBe(1);
  });
});
