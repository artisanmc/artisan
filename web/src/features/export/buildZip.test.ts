import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildZip } from "./buildZip";

describe("buildZip", () => {
  it("produces a Blob containing the given files", async () => {
    const files = {
      "plugins/Interfaze/manifest.yaml": "schema: manifest/v1\n",
      "plugins/Interfaze/translations.yaml": "schema: translations/v1\n",
    };
    const blob = await buildZip(files);
    expect(blob).toBeInstanceOf(Blob);

    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files);
    expect(names).toContain("plugins/Interfaze/manifest.yaml");
    expect(names).toContain("plugins/Interfaze/translations.yaml");

    const content = await zip.file("plugins/Interfaze/manifest.yaml")!.async("string");
    expect(content).toBe("schema: manifest/v1\n");
  });
});
