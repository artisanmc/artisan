import JSZip from "jszip";
import { expect, test } from "vitest";
import { normalizeProjectFiles, readProjectZip } from "./projectZip";
test("portable import preserves PNG and font bytes while excluding private drafts", async () => {
  const zip = new JSZip();
  zip.file("demo/manifest.yaml", "name: Demo\n");
  zip.file("demo/textures/test.png", new Uint8Array([137, 80, 78, 71, 0, 255]));
  zip.file("demo/fonts/font.ttf", new Uint8Array([0, 1, 0, 0, 255]));
  zip.file("demo/.artisan/editor.yaml", "positions: {}\n");
  zip.file("demo/.artisan/drafts/private/envelope.json", "secret");
  const data = await zip.generateAsync({ type: "uint8array" });
  const entries = await readProjectZip(data as unknown as Blob);
  const normalized = normalizeProjectFiles(entries);
  expect(normalized.files["plugins/Artisan/projects/demo/textures/test.png"]).toEqual(
    new Uint8Array([137, 80, 78, 71, 0, 255]),
  );
  expect(normalized.files["plugins/Artisan/projects/demo/fonts/font.ttf"]).toEqual(
    new Uint8Array([0, 1, 0, 0, 255]),
  );
  expect(normalized.files["plugins/Artisan/projects/demo/.artisan/editor.yaml"]).toBe(
    "positions: {}\n",
  );
  expect(Object.keys(normalized.files).some((path) => path.includes("drafts"))).toBe(false);
});
