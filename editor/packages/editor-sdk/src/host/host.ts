/**
 * What a module's view needs from the editor that hosts it: the open Project, its texts,
 * the writes to its Documents. The host installs one implementation at boot
 * (`installEditorHost`); a module reaches it only through the functions below, so a
 * bundle loaded at runtime and a module compiled into the editor see the same thing.
 *
 * Projects and Documents stay `unknown` here, as in `DocumentKindContribution`: a module
 * knows the shape of its own Documents, never the host's domain types.
 */
export interface EditorHost {
  /** The open Project `projectId` (a hook: re-renders when it changes), or undefined. */
  useProject(projectId: string): unknown | undefined;
  /** The language texts are edited in (the editor's content-language switch). A hook. */
  useContentLang(): string;
  /** The editor's own interface language ("en", "fr"), for a module's labels. A hook. */
  useUiLang(): string;
  /** Replaces a Document wholesale and sets texts, in one undoable step. */
  updateDocument(input: {
    projectId: string;
    kind: string;
    id: string;
    doc: unknown;
    texts?: TextWrite[];
  }): void;
  /** A fresh text key, for a text site a view adds (its canonical key is set at export). */
  newTextKey(): string;
  /** A text's value in `lang`, else in the Project's default language, else "". */
  text(project: unknown, key: string, lang: string): string;
  /** A text as a Document file carries it: a bare string, or `{lang: text}`. */
  fieldText(project: unknown, key: string): string | Record<string, string>;
  /** The Project's languages, its default first. */
  langs(project: unknown): string[];
  /** Briefly tells the user something (a refused value, a done operation). */
  notify(message: string, tone?: "info" | "error"): void;
}

/** One text written with a Document: the node's key, a language, a value. */
export interface TextWrite {
  key: string;
  lang: string;
  value: string;
}

let host: EditorHost | null = null;

/** Installed once by the editor before any module renders. */
export function installEditorHost(impl: EditorHost): void {
  host = impl;
}

function current(): EditorHost {
  if (!host) throw new Error("@artisan/editor-sdk: no editor host is installed");
  return host;
}

export const useProject = (projectId: string): unknown | undefined =>
  current().useProject(projectId);
export const useContentLang = (): string => current().useContentLang();
export const useUiLang = (): string => current().useUiLang();
export const updateDocument: EditorHost["updateDocument"] = (input) =>
  current().updateDocument(input);
export const newTextKey = (): string => current().newTextKey();
export const textValue = (project: unknown, key: string, lang: string): string =>
  current().text(project, key, lang);
export const fieldText = (project: unknown, key: string): string | Record<string, string> =>
  current().fieldText(project, key);
export const projectLangs = (project: unknown): string[] => current().langs(project);
export const notify: EditorHost["notify"] = (message, tone) => current().notify(message, tone);
