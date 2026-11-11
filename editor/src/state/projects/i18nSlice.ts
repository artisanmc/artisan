import { adoptProjectActionTexts } from "@/domain/i18nSites";
import type { LText, ProjectId } from "@/domain/types";
import { setLText } from "@/lib/i18n";
import { findUnusedI18nKeys } from "@/lib/i18nUsages";
import { current } from "immer";
import type { ProjectsSliceContext } from "./types";

/** The Project's languages. */
export interface I18nSlice {
  /**
   * Update the value of an i18n entry under `lang`. Used by every text
   * field whose component already holds the `LText` ref (menu title,
   * appearance title/lore lines, send_message text in actions). Path-
   * based step mutators handle structure; this handles content.
   */
  setI18nValue: (input: { projectId: ProjectId; lt: LText; lang: string; value: string }) => void;
  /**
   * Adopt the wire texts of module actions into LText nodes at their canonical address
   * (`adoptProjectActionTexts`): run when the server's declared actions become known
   * after the project was read, so those texts join the Translations panel.
   */
  adoptActionTexts: (input: { projectId: ProjectId }) => void;
  /** Add a new language to the project (clones empty entries from defaultLang for every existing key). */
  addLanguage: (input: { projectId: ProjectId; lang: string }) => void;
  /** Remove a language and all its translations. No-op on `defaultLang`. */
  removeLanguage: (input: { projectId: ProjectId; lang: string }) => void;
  /**
   * Drop every i18n key the editor can prove unused: no longer referenced
   * anywhere in the project, at an address only the editor derives (stale
   * leftovers from deleted elements / re-imports). Keys read by an add-on's
   * code stay. Returns nothing; undoable. See {@link findUnusedI18nKeys}.
   */
  removeUnusedI18nKeys: (input: { projectId: ProjectId }) => void;
  /** Change the project's default language (the fallback when a key has no entry in the active lang). */
  setProjectDefaultLang: (input: { projectId: ProjectId; lang: string }) => void;
}

export const createI18nSlice = ({ mutateProject }: ProjectsSliceContext): I18nSlice => ({
  setI18nValue: ({ projectId: pId, lt, lang, value }) =>
    mutateProject(pId, (project) => {
      setLText(project, lt, lang, value);
    }),
  adoptActionTexts: ({ projectId: pId }) =>
    mutateProject(
      pId,
      (project) => {
        adoptProjectActionTexts(project);
      },
      { touch: false },
    ),
  addLanguage: ({ projectId: pId, lang }) => {
    if (!lang) throw new Error("language code cannot be empty");
    mutateProject(pId, (project) => {
      // Idempotent: re-adding an existing lang is a no-op. We
      // don't seed empty entries for every key — fallback to
      // defaultLang at read time covers untranslated keys. Just
      // touch one entry so future enumeration code can spot the
      // language. (If the project has no keys at all, the language
      // doesn't need recording anywhere.)
      for (const entry of Object.values(project.i18nKeys)) {
        if (!entry) continue;
        if (!(lang in entry)) entry[lang] = "";
        break;
      }
    });
  },
  removeLanguage: ({ projectId: pId, lang }) =>
    mutateProject(pId, (project) => {
      if (lang === project.defaultLang) return false; // refuse to drop the default
      for (const entry of Object.values(project.i18nKeys)) {
        if (entry) delete entry[lang];
      }
    }),
  removeUnusedI18nKeys: ({ projectId: pId }) =>
    mutateProject(pId, (project) => {
      // Walk a plain snapshot (`current`) rather than the immer draft —
      // findKeyUsages only reads, and the proxy walk is needless overhead.
      const unused = findUnusedI18nKeys(current(project));
      if (unused.length === 0) return false;
      for (const key of unused) delete project.i18nKeys[key];
    }),
  setProjectDefaultLang: ({ projectId: pId, lang }) =>
    mutateProject(pId, (project) => {
      if (!lang) return false;
      project.defaultLang = lang;
    }),
});
