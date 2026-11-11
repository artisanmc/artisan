export const projectIdentityEn = {
  importTitle: "Import project",
  importDescription: "This archive has no project folder. Choose the folder name to use.",
  folder: "Project folder",
  folderHint: "Use letters, numbers, underscores or hyphens (up to 128 characters).",
  edit: "Edit",
  renameTitle: "Change project ID",
  renameDescription:
    "Change the project ID (its folder on the server) while keeping its drafts and links.",
  rename: "Save",
  retry: "Retry",
  pending: "Rename pending. Reconnect the server, then retry to confirm the result.",
  occupied: "That project folder already exists. Choose another name.",
  reserved: "That name is reserved by an earlier rename. Choose another name.",
  invalidTarget: "That folder name is invalid. Choose another name.",
  immutable: "This project is managed by an add-on and cannot be renamed.",
  missing: "This project no longer exists on the server. Reload the project list.",
  serverOffline: "The server is offline. Connect it to rename the project.",
  updateRequired: "This server runs an older Artisan. Update its plugin to rename projects.",
  rejected: "The rename was rejected. You can choose another name and try again.",
  retryError: "The rename could not be confirmed. Retry to recover its result.",
  importExists:
    "A project “{{folder}}” already exists in this Network. Import under another folder name, or overwrite it.",
  importOverwrite: "Overwrite “{{folder}}”",
  importOverwriteHint:
    "Overwriting replaces all of its content with the archive. The previous version stays in the project's history.",
};

export const projectIdentityFr: typeof projectIdentityEn = {
  importTitle: "Importer le projet",
  importDescription:
    "Cette archive n'a pas de dossier de projet. Choisissez le nom du dossier à utiliser.",
  folder: "Dossier du projet",
  folderHint: "Utilisez des lettres, chiffres, tirets ou underscores (128 caractères maximum).",
  edit: "Modifier",
  renameTitle: "Modifier l'ID du projet",
  renameDescription:
    "Modifiez l'ID du projet (son dossier sur le serveur) en conservant ses brouillons et ses liens.",
  rename: "Enregistrer",
  retry: "Réessayer",
  pending:
    "Renommage en attente. Reconnectez le serveur, puis réessayez pour confirmer le résultat.",
  occupied: "Ce dossier de projet existe déjà. Choisissez un autre nom.",
  reserved: "Ce nom est réservé par un renommage précédent. Choisissez un autre nom.",
  invalidTarget: "Ce nom de dossier est invalide. Choisissez un autre nom.",
  immutable: "Ce projet est géré par un add-on et ne peut pas être renommé.",
  missing: "Ce projet n'existe plus sur le serveur. Rechargez la liste des projets.",
  serverOffline: "Le serveur est hors ligne. Connectez-le pour renommer le projet.",
  updateRequired:
    "Ce serveur utilise une version plus ancienne d'Artisan. Mettez son plugin à jour pour renommer des projets.",
  rejected: "Le renommage a été refusé. Vous pouvez choisir un autre nom et réessayer.",
  retryError: "Le renommage n'a pas pu être confirmé. Réessayez pour récupérer son résultat.",
  importExists:
    "Un projet « {{folder}} » existe déjà dans ce network. Importez sous un autre nom de dossier, ou écrasez-le.",
  importOverwrite: "Écraser « {{folder}} »",
  importOverwriteHint:
    "Écraser remplace tout son contenu par celui de l'archive. La version précédente reste dans l'historique du projet.",
};
