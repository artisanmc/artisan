import type { LText, ProjectId } from "@/domain/types";
import { adoptProjectActionTexts } from "@/domain/i18nSites";
import { setLText } from "@/lib/i18n";
import { findUnusedI18nKeys } from "@/lib/i18nUsages";
import { current, produce } from "immer";
import type { AccountSliceContext, AccountState } from "./types";

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
   * Choose how texts are written on disk: `inline` (the document carries the
   * default language's literal, other languages travel in `lang/` by address)
   * or `extract` (`{i18n:key}` refs everywhere). Pure file shape — no
   * translation is touched. Cf. ADR `files-first-source-of-truth` §4.
   */
  setProjectI18nMode: (input: { projectId: ProjectId; mode: "extract" | "inline" }) => void;
  /**
   * Drop every i18n key that's no longer referenced anywhere in the project
   * (stale leftovers from deleted elements / re-imports). Returns nothing;
   * undoable. See {@link findUnusedI18nKeys}.
   */
  removeUnusedI18nKeys: (input: { projectId: ProjectId }) => void;
  /** Change the project's default language (the fallback when a key has no entry in the active lang). */
  setProjectDefaultLang: (input: { projectId: ProjectId; lang: string }) => void;
}

export const createI18nSlice = ({ set }: AccountSliceContext): I18nSlice => ({
  setI18nValue: ({ projectId: pId, lt, lang, value }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        setLText(project, lt, lang, value);
        project.updatedAt = new Date().toISOString();
      }),
    ),
  adoptActionTexts: ({ projectId: pId }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (project) adoptProjectActionTexts(project);
      }),
    ),
  addLanguage: ({ projectId: pId, lang }) => {
    if (!lang) throw new Error("language code cannot be empty");
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
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
        project.updatedAt = new Date().toISOString();
      }),
    );
  },
  setProjectI18nMode: ({ projectId: pId, mode }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        // `extract` is the default and leaves no marker — on disk as here,
        // so a project that never touched the toggle stays clean.
        if (mode === "inline") project.i18nMode = "inline";
        else Reflect.deleteProperty(project, "i18nMode");
        project.updatedAt = new Date().toISOString();
      }),
    ),
  removeLanguage: ({ projectId: pId, lang }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        if (lang === project.defaultLang) return; // refuse to drop the default
        for (const entry of Object.values(project.i18nKeys)) {
          if (entry) delete entry[lang];
        }
        project.updatedAt = new Date().toISOString();
      }),
    ),
  removeUnusedI18nKeys: ({ projectId: pId }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        // Walk a plain snapshot (`current`) rather than the immer draft —
        // findKeyUsages only reads, and the proxy walk is needless overhead.
        const unused = findUnusedI18nKeys(current(project));
        if (unused.length === 0) return;
        for (const key of unused) delete project.i18nKeys[key];
        project.updatedAt = new Date().toISOString();
      }),
    ),
  setProjectDefaultLang: ({ projectId: pId, lang }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        if (!lang) return;
        project.defaultLang = lang;
        project.updatedAt = new Date().toISOString();
      }),
    ),
});
