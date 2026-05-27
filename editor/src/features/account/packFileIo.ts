import type { Pack } from "@/domain/types";

export function exportPackToFile(pack: Pack): void {
  const json = JSON.stringify(pack, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = pack.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  a.download = `${safeName || "pack"}.interfaze.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ImportPackResult {
  newId: string;
  name: string;
}

export function importPackFromFile(
  file: File,
  importPackAction: (input: { pack: unknown }) => string,
): Promise<ImportPackResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? "")) as { name?: string };
        const newId = importPackAction({ pack: parsed });
        resolve({ newId, name: parsed.name ?? "pack" });
      } catch (e) {
        reject(e instanceof Error ? e : new Error("import_failed"));
      }
    };
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsText(file);
  });
}

export function pickPackFileForImport(onPick: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}
