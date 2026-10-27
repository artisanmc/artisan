import { projectId } from "@/domain/ids";
import type { Project } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import editorState from "../project/.artisan/editor.yaml";

/** Id du projet de démo : tout le canvas de la vidéo l'affiche. */
export const DEMO_PROJECT_ID = projectId("skyward");

// Les fichiers de project/ sont lus par le même codec que l'éditeur utilise
// pour un projet publié sur le disque du serveur.
const context = require.context("../project", true, /\.ya?ml$/);
const files: Record<string, string> = {};
for (const key of context.keys()) {
  files[`plugins/Artisan/projects/${DEMO_PROJECT_ID}/${key.replace(/^\.\//, "")}`] = context(key) as string;
}
// require.context ignore les dossiers cachés : la disposition du canvas est lue à part.
files[`plugins/Artisan/projects/${DEMO_PROJECT_ID}/.artisan/editor.yaml`] = editorState;

export function demoProject(): Project {
  return projectFromFiles(DEMO_PROJECT_ID, files, { name: "Skyward Network" });
}
