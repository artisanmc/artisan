import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { adoptDiskIntoProject } from "@/features/project/saveProjectToDisk";
import { hashContent } from "@/lib/contentHash";
import { writeProjectFiles } from "@/lib/api/projectFiles";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import type { Project } from "@/domain/types";

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
  networkId,
  serverId,
}: {
  project: Project;
  relPath: string;
  networkId: string;
  serverId: string;
}) {
  const { t } = useTranslation();
  const baseline = useProjectBaselineStore((s) => s.baselines[project.id]);
  const replaceProject = useAccountStore((s) => s.replaceProject);
  const original = baseline?.[relPath] ?? "";
  const [text, setText] = useState(original);
  const [saving, setSaving] = useState(false);

  const dirty = text !== original;

  const save = async () => {
    setSaving(true);
    try {
      const res = await writeProjectFiles(networkId, serverId, project.diskId ?? project.id, {
        // Le compare-and-swap habituel : le hash de ce qu'on croyait trouver.
        // Une écriture verbatim n'est pas une écriture privilégiée.
        files: [{ path: relPath, content: text, base_hash: await hashContent(original) }],
        deletes: [],
      });
      if (!res.ok) {
        toast.error(
          res.error === "conflict" ? t("yamlView.conflict") : t("save.failed"),
        );
        return;
      }
      // La base avance, et le Project est re-parsé depuis le texte écrit : sans
      // ça l'éditeur visuel continuerait d'afficher l'ancienne version.
      useProjectBaselineStore
        .getState()
        .set(project.id, { ...(baseline ?? {}), [relPath]: text });
      replaceProject(adoptDiskIntoProject(project, { [relPath]: text }, []));
      toast.success(t("save.saved"));
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
    </div>
  );
}
