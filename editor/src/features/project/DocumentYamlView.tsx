import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { documentKindDef, isDocumentKind } from "@/domain/documentKinds";
import { documentPath } from "@/domain/documentLayout";
import { findDocumentRef } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import { adoptDiskIntoProject } from "@/features/project/saveProjectToDisk";
import { hashContent } from "@/lib/contentHash";
import { projectClient } from "@/lib/projectClient";
import { yamlPathOnDisk } from "@/lib/yamlFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileHistory } from "./FileHistory";

/**
 * A Document's file (by key, or a bare id: `findDocumentRef`): its folder says its kind, its name
 * its identity, the disk its extension (`yamlPathOnDisk`).
 */
export function documentRelPath(project: Project, id: string): string | null {
  const found = findDocumentRef(project, id);
  if (!found) return null;
  // A kind nobody registered (its module is absent) keeps its folder name as the kind.
  const dir = isDocumentKind(found.kind) ? documentKindDef(found.kind).dir : found.kind;
  const path = documentPath(dir, found.doc.id, found.doc.folder);
  return yamlPathOnDisk(path, useProjectBaselineStore.getState().get(project.id) ?? {});
}

/**
 * A Document's file, as is — the "code mode".
 *
 * **Writing is verbatim.** Canonicalising even from the YAML tab erased an
 * admin's comments on THEIR own menus. Since `server-disk-only-storage`, the
 * disk is the only store and hand editing is a first-class path: what you
 * type is what lands.
 *
 * Accepted trade-off: the two modes no longer produce the same bytes for the
 * same content. Touching the visual editor regenerates the document and
 * reformats it — but the text is right in front of you, so it is visible
 * instead of a surprise afterwards.
 */
export function DocumentYamlView({
  project,
  relPath,
}: {
  project: Project;
  relPath: string;
  serverId?: string;
}) {
  const { t } = useTranslation();
  const baseline = useProjectBaselineStore((s) => s.baselines[project.id]);
  const replaceProject = useProjectsStore((s) => s.replaceProject);
  const original = baseline?.[relPath] ?? "";
  const [text, setText] = useState(original);
  const [saving, setSaving] = useState(false);
  const pending = useRef<{
    operationId: string;
    files: { path: string; content: string; base_hash: string }[];
    deletes: [];
  } | null>(null);

  const dirty = text !== original;

  const save = async () => {
    setSaving(true);
    try {
      const request = pending.current ?? {
        operationId: crypto.randomUUID(),
        // The usual compare-and-swap: the hash of what we expected to find. A
        // verbatim write is not a privileged write.
        files: [{ path: relPath, content: text, base_hash: await hashContent(original) }],
        deletes: [] as [],
      };
      pending.current = request;
      const res = await projectClient(project.id).write(request);
      if (!res.ok) {
        if (res.error === "conflict") pending.current = null;
        toast.error(res.error === "conflict" ? t("yamlView.conflict") : t("save.failed"));
        return;
      }
      pending.current = null;
      const written = request.files[0]!.content;
      // The base moves forward, and the Project is re-parsed from the written text:
      // otherwise the visual editor would keep showing the old version.
      useProjectBaselineStore.getState().set(project.id, {
        ...(useProjectBaselineStore.getState().get(project.id) ?? {}),
        [relPath]: written,
      });
      const current =
        useProjectsStore.getState().openProjects.projects.find((item) => item.id === project.id) ??
        project;
      replaceProject(adoptDiskIntoProject(current, { [relPath]: written }, []));
      toast.success(t("save.saved"));
      rebuildServerPackInBackground(t, project.serverKeyId);
    } catch {
      toast.error(t("save.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate text-[11px] text-[var(--text-mut)]">{relPath}</code>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? t("save.saving") : t("save.save")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--border-soft)] bg-[var(--surface)]">
        <YamlCodeEditor value={text} ariaLabel={relPath} onChange={setText} />
      </div>
      <p className="text-[11px] text-[var(--text-faint)]">{t("yamlView.verbatimHint")}</p>
      <FileHistory projectId={project.id} path={relPath} onRestore={setText} />
    </div>
  );
}
