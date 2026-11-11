import { documentKindDef, isDocumentKind } from "@/domain/documentKinds";
import { ORIGINALS_DIR, documentPath } from "@/domain/documentLayout";
import { allDocuments, docKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import type { ActiveModule } from "@/lib/api/modules";
import type { FileOrigin } from "@/lib/api/templates";
import { sameYamlFile, yamlPathOnDisk } from "@/lib/yamlFiles";

/**
 * The Documents of [project] that are a module's system elements (a `system` template,
 * design `framework-commandes` §3.8), by key (`docKey`), with that module: what the origins recorded
 * at their path says, while the module still announces the template. The editor never
 * deletes, moves or renames them; Reset puts the module's version back.
 */
export function systemDocuments(
  project: Project,
  modules: ActiveModule[],
  origins: Record<string, FileOrigin>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const { kind, doc } of allDocuments(project)) {
    const dir = isDocumentKind(kind) ? documentKindDef(kind).dir : kind;
    // The owner's version, else the module's original (design `originaux-modules`).
    const own = yamlPathOnDisk(documentPath(dir, doc.id, doc.folder), origins);
    const shipped = yamlPathOnDisk(
      `${ORIGINALS_DIR}/${documentPath(dir, doc.id, doc.folder)}`,
      origins,
    );
    const origin = origins[own] ?? origins[shipped];
    if (!origin) continue;
    const path = origins[own] ? own : shipped.slice(ORIGINALS_DIR.length + 1);
    const template = modules
      .find((m) => m.id === origin.module)
      ?.templates?.find((t) => t.id === origin.template);
    if (template?.system && template.files.some((f) => sameYamlFile(f.path, path))) {
      out.set(docKey(kind, doc.id), origin.module);
    }
  }
  return out;
}
