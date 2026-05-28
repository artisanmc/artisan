import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
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
  for (const menu of exportPack.menus) rekeyMenuLTexts(exportPack, menu);
  for (const cmd of exportPack.commands) rekeyCommandLTexts(exportPack, cmd);

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
