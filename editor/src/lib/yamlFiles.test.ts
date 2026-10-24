import { describe, expect, it } from "vitest";
import { keepYamlExtensions, yamlFilesUnder, yamlPathOnDisk, yamlStem } from "./yamlFiles";

describe("yamlFiles", () => {
  it("strips either extension", () => {
    expect(yamlStem("menus/a.yml")).toBe("menus/a");
    expect(yamlStem("menus/a.yaml")).toBe("menus/a");
    expect(yamlStem("menus/a.png")).toBeNull();
  });

  it("lists the files right under a folder, a twin by its .yml copy", () => {
    const paths = ["data/b.yaml", "data/a.yaml", "data/a.yml", "data/rows/x.yml", "data/c.txt"];
    expect(yamlFilesUnder(paths, "data/")).toEqual([
      ["a", "data/a.yml"],
      ["b", "data/b.yaml"],
    ]);
  });

  it("writes a file back under the extension the disk has", () => {
    const disk = { "menus/shop.yml": "x", "lang/en.yaml": "y" };
    expect(yamlPathOnDisk("menus/shop.yaml", disk)).toBe("menus/shop.yml");
    expect(yamlPathOnDisk("menus/new.yaml", disk)).toBe("menus/new.yaml");
    expect(
      keepYamlExtensions(
        { "menus/shop.yaml": "x2", "lang/en.yaml": "y", "menus/new.yaml": "z" },
        disk,
      ),
    ).toEqual({ "menus/shop.yml": "x2", "lang/en.yaml": "y", "menus/new.yaml": "z" });
    // Both spellings in the tree: each stays where it is.
    expect(keepYamlExtensions({ "a.yaml": "1", "a.yml": "2" }, { "a.yml": "2" })).toEqual({
      "a.yaml": "1",
      "a.yml": "2",
    });
  });
});
