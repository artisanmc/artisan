export const mcpEn = {
  consent: {
    title: "Connect {{client}}",
    titleGeneric: "Connect an AI client",
    intro: "{{client}} asks to work in Artisan as {{player}}.",
    can: "It will be able to",
    canRead: "read the Projects and documents of your servers",
    canDraft: "create drafts and write documents in them, each file checked by the server first",
    cannot:
      "It will not be able to deploy: you review each draft in the editor and deploy it yourself.",
    redirect: "You will then return to {{host}}.",
    approve: "Allow",
    deny: "Deny",
    needEdit: "Connecting an AI client requires the artisan.editor.edit permission.",
    signIn:
      "Sign in to the editor first: type /artisan editor in game and open the link. This page goes on once you are signed in.",
    invalid: "This connection request is not valid. Start it again from your AI client.",
    returning: "Returning to {{host}}…",
    failed: "The answer could not be sent. Try again.",
  },
  apps: {
    title: "AI apps",
    help: "AI clients you allowed to prepare drafts for you. They never deploy.",
    howTo: "Add this address as a custom connector (MCP) in Claude, ChatGPT or another client:",
    copy: "Copy",
    copied: "Copied",
    empty: "No AI client connected yet.",
    since: "Connected {{date}} · last used {{used}}",
    revoke: "Disconnect",
    revokeFailed: "Could not disconnect this client. Try again.",
    disabled:
      "The MCP endpoint is off on this server. An admin turns it on with web.mcp: true in environment.yml.",
    loading: "Loading…",
  },
};

export const mcpFr: typeof mcpEn = {
  consent: {
    title: "Connecter {{client}}",
    titleGeneric: "Connecter un client IA",
    intro: "{{client}} demande à travailler dans Artisan en tant que {{player}}.",
    can: "Il pourra",
    canRead: "lire les Projects et les documents de vos serveurs",
    canDraft:
      "créer des brouillons et y écrire des documents, chaque fichier vérifié d'abord par le serveur",
    cannot:
      "Il ne pourra pas déployer : vous relisez chaque brouillon dans l'éditeur et le déployez vous-même.",
    redirect: "Vous reviendrez ensuite sur {{host}}.",
    approve: "Autoriser",
    deny: "Refuser",
    needEdit: "Connecter un client IA demande la permission artisan.editor.edit.",
    signIn:
      "Connectez-vous d'abord à l'éditeur : tapez /artisan editor en jeu et ouvrez le lien. Cette page continue une fois connecté.",
    invalid: "Cette demande de connexion n'est pas valide. Relancez-la depuis votre client IA.",
    returning: "Retour vers {{host}}…",
    failed: "La réponse n'a pas pu être envoyée. Réessayez.",
  },
  apps: {
    title: "Applications IA",
    help: "Les clients IA que vous avez autorisés à préparer des brouillons pour vous. Ils ne déploient jamais.",
    howTo:
      "Ajoutez cette adresse comme connecteur personnalisé (MCP) dans Claude, ChatGPT ou un autre client :",
    copy: "Copier",
    copied: "Copié",
    empty: "Aucun client IA connecté pour l'instant.",
    since: "Connecté {{date}} · dernière utilisation {{used}}",
    revoke: "Déconnecter",
    revokeFailed: "Impossible de déconnecter ce client. Réessayez.",
    disabled:
      "Le point d'entrée MCP est désactivé sur ce serveur. Un admin l'active avec web.mcp: true dans environment.yml.",
    loading: "Chargement…",
  },
};
