import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import type { Project } from "@/domain/types";
import { adoptDiskIntoProject } from "@/features/project/saveProjectToDisk";
import { hashContent } from "@/lib/contentHash";
import { projectClient } from "@/lib/projectClient";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileHistory } from "./FileHistory";

/**
 * Le fichier d'un Document, tel quel — la « code mode » qui a déclenché toute
 * l'épopée files-first (« a feature request (a "code mode" showing a Document's
 * YAML beside the visual editor) escalated into the storage question »).
 *
 * **L'écriture est verbatim.** L'ADR `yaml-assisted-editing` canonicalisait même
 * depuis l'onglet YAML, et réservait le verbatim aux fichiers étrangers ; c'est
 * ce qui effaçait les commentaires d'un admin sur SES propres menus. Cette règle
 * a été écrite quand l'éditeur web était la surface principale et le fichier une
 * projection. Depuis `server-disk-only-storage`, le disque est le seul store et
 * l'édition à la main un chemin de plein droit : ce que tu tapes est ce qui
 * atterrit.
 *
 * Contrepartie assumée : les deux modes ne produisent plus les mêmes octets pour
 * le même contenu. Toucher l'éditeur visuel régénère le document et reformate —
 * mais tu as le texte sous les yeux, donc c'est visible au lieu d'être une
 * surprise après coup.
 */
export function DocumentYamlView({
  project,
  relPath,
}: {
  project: Project;
  relPath: string;
  networkId?: string;
  serverId?: string;
}) {
  const { t } = useTranslation();
  const baseline = useProjectBaselineStore((s) => s.baselines[project.id]);
  const replaceProject = useAccountStore((s) => s.replaceProject);
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
        // Le compare-and-swap habituel : le hash de ce qu'on croyait trouver.
        // Une écriture verbatim n'est pas une écriture privilégiée.
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
      // La base avance, et le Project est re-parsé depuis le texte écrit : sans
      // ça l'éditeur visuel continuerait d'afficher l'ancienne version.
      useProjectBaselineStore.getState().set(project.id, {
        ...(useProjectBaselineStore.getState().get(project.id) ?? {}),
        [relPath]: written,
      });
      const current =
        useAccountStore.getState().account.projects.find((item) => item.id === project.id) ??
        project;
      replaceProject(adoptDiskIntoProject(current, { [relPath]: written }, []));
      toast.success(t("save.saved"));
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
