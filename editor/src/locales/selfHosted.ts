export const selfHostedEn = {
  signIn: {
    title: "Open the editor from the game",
    body: "This editor is served by your Minecraft server. Run this command in game to get a single-use sign-in link:",
    command: "/artisan editor",
    expired: "This link has expired or was already used. Run the command again for a new one.",
    permission: "You need the artisan.editor.view permission.",
  },
};

export const selfHostedFr: typeof selfHostedEn = {
  signIn: {
    title: "Ouvrir l'éditeur depuis le jeu",
    body: "Cet éditeur est servi par ton serveur Minecraft. Lance cette commande en jeu pour obtenir un lien de connexion à usage unique :",
    command: "/artisan editor",
    expired: "Ce lien a expiré ou a déjà servi. Relance la commande pour en obtenir un nouveau.",
    permission: "Il faut la permission artisan.editor.view.",
  },
};
