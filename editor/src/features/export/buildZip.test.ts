import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildZip } from "./buildZip";

describe("buildZip", () => {
  it("produces a Blob containing the given files", async () => {
    const files = {
      "main/artisan-module.yml": "schema: module/v1\n",
      "main/translations.yml": "schema: translations/v1\n",
    };
    const blob = await buildZip(files);
    expect(blob).toBeInstanceOf(Blob);

    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files);
    expect(names).toContain("main/artisan-module.yml");
    expect(names).toContain("main/translations.yml");

    const content = await zip.file("main/artisan-module.yml")!.async("string");
    expect(content).toBe("schema: module/v1\n");
  });
});
