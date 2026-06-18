import JSZip from "jszip";

/**
 * Bundle a flat map of path → YAML content into a zip Blob.
 * Paths may contain directory separators (e.g. "plugins/Artisan/menus/shop.yaml")
 * and JSZip will create the intermediate directories automatically.
 */
export async function buildZip(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
