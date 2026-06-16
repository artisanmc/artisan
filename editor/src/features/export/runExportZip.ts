import { rekeyPack } from "@/domain/i18nSites";
import type { Pack } from "@/domain/types";
import { buildZip } from "./buildZip";
import { transform } from "./transform";
import { validate } from "./validate";

export interface ExportZipResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates the pack, transforms to YAML files, bundles into a .zip and
 * triggers a browser download. Returns validation errors/warnings so the
 * caller can surface them (validation failures abort the download).
 */
export async function runExportZip(pack: Pack): Promise<ExportZipResult> {
  const exportPack = structuredClone(pack);
  rekeyPack(exportPack);

  const result = validate(exportPack);
  if (!result.valid) {
    return { ok: false, errors: result.errors, warnings: result.warnings };
  }

  const files = transform(exportPack);
  const blob = await buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${pack.id}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { ok: true, errors: [], warnings: result.warnings };
}
