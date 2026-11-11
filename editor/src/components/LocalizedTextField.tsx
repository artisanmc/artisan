import { type LocalizedEditorProps, LocalizedField } from "@/components/ui/localized-field";
import type { LText, ProjectId } from "@/domain/types";
import { useFieldTranslate } from "@/lib/aiTranslate";
import { listLanguages } from "@/lib/i18nUsages";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import type { ReactNode } from "react";

export interface LocalizedTextFieldProps {
  projectId: ProjectId;
  /** The text's node; absent = no text yet, the owner's `onChange` creates it. */
  lt: LText | null | undefined;
  label: string;
  /** Writes one language; default `setI18nValue` on `lt`. */
  onChange?: (lang: string, value: string) => void;
  renderEditor: (props: LocalizedEditorProps) => ReactNode;
  actions?: ReactNode;
  /** See {@link LocalizedField}'s `inline`. */
  inline?: boolean;
  className?: string;
}

/**
 * {@link LocalizedField} on a Project text: its languages, the top bar's language and
 * each language's own value come from the stores. Every translatable text of the
 * editor goes through it, so all of them fold, unfold and count missing translations
 * the same way, and offer "Translate the missing ones" when the assistant is on.
 */
export function LocalizedTextField({
  projectId,
  lt,
  label,
  onChange,
  renderEditor,
  actions,
  inline,
  className,
}: LocalizedTextFieldProps) {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  const setI18nValue = useProjectsStore((s) => s.setI18nValue);
  const translate = useFieldTranslate(projectId);
  if (!project) return null;
  const entry = lt ? (project.i18nKeys[lt.key] ?? {}) : {};
  return (
    <LocalizedField
      className={className}
      label={label}
      langs={listLanguages(project)}
      activeLang={activeLang}
      defaultLang={project.defaultLang}
      values={entry}
      onChange={onChange ?? ((lang, value) => lt && setI18nValue({ projectId, lt, lang, value }))}
      renderEditor={renderEditor}
      actions={actions}
      inline={inline}
      translate={translate}
    />
  );
}
