/** The editor's assistant (ADR `editor-assistant`). */
export const aiEn = {
  open: "Assistant",
  title: "Assistant",
  intro:
    "Describe what you want: a menu, a command, a change to a dialog. The assistant reads this project and writes a draft, each file checked by the server. You review it in Drafts and deploy it yourself.",
  billing: "Runs on your server's {{model}} account: each message is billed to its key.",
  placeholder: "Ask the assistant…",
  send: "Send",
  working: "Working…",
  new: "New",
  newHint: "Start a new conversation",
  resize: "Resize the assistant",
  close: "Close the assistant",
  problems_one: "{{count}} problem",
  problems_other: "{{count}} problems",
  openDrafts: "Open “{{name}}” in Drafts",
  tools: {
    artisan_overview: "Looked at the servers and projects",
    list_documents: "Listed the documents",
    read_document: "Read {{path}}",
    get_kind_guide: "Read a document kind's guide",
    read_docs: "Read the Artisan docs",
    start_draft: "Started a draft",
    write_document: "Wrote {{path}}",
  },
  notices: {
    ai_step_limit: "The assistant stopped after {{steps}} steps. Send a message to let it go on.",
    ai_output_limit: "The answer was cut: it was too long. Ask for less at a time.",
    ai_refused: "The model declined this request.",
  },
  errors: {
    ai_key_refused:
      "The model provider refused the server's API key. Ask an admin to check ai.api-key.",
    ai_rate_limited: "The model provider is limiting requests. Try again in a minute.",
    ai_unreachable: "The server could not reach the model provider.",
    ai_provider_error: "The model provider returned an error. Try again.",
    ai_busy: "The assistant is still answering.",
    not_found:
      "This conversation ended (the server restarted). Your next message starts a new one.",
    forbidden: "Talking to the assistant requires the artisan.editor.edit permission.",
    network_error: "The editor cannot reach the server.",
    unknown: "Something went wrong. Try again.",
  },
};

export const aiFr: typeof aiEn = {
  open: "Assistant",
  title: "Assistant",
  intro:
    "Décris ce que tu veux : un menu, une commande, une modification de dialogue. L’assistant lit ce projet et écrit un brouillon, chaque fichier vérifié par le serveur. Tu le relis dans Brouillons et tu le déploies toi-même.",
  billing: "Tourne sur le compte {{model}} du serveur : chaque message est facturé à sa clé.",
  placeholder: "Demande à l’assistant…",
  send: "Envoyer",
  working: "En cours…",
  new: "Nouvelle",
  newHint: "Commencer une nouvelle conversation",
  resize: "Redimensionner l’assistant",
  close: "Fermer l’assistant",
  problems_one: "{{count}} problème",
  problems_other: "{{count}} problèmes",
  openDrafts: "Ouvrir « {{name}} » dans Brouillons",
  tools: {
    artisan_overview: "A regardé les serveurs et les projets",
    list_documents: "A listé les documents",
    read_document: "A lu {{path}}",
    get_kind_guide: "A lu le guide d’un type de document",
    read_docs: "A lu la doc d’Artisan",
    start_draft: "A créé un brouillon",
    write_document: "A écrit {{path}}",
  },
  notices: {
    ai_step_limit:
      "L’assistant s’est arrêté après {{steps}} étapes. Envoie un message pour qu’il continue.",
    ai_output_limit: "La réponse a été coupée : elle était trop longue. Demande moins à la fois.",
    ai_refused: "Le modèle a décliné cette demande.",
  },
  errors: {
    ai_key_refused:
      "Le fournisseur du modèle refuse la clé d’API du serveur. Demande à un admin de vérifier ai.api-key.",
    ai_rate_limited: "Le fournisseur du modèle limite les requêtes. Réessaie dans une minute.",
    ai_unreachable: "Le serveur n’arrive pas à joindre le fournisseur du modèle.",
    ai_provider_error: "Le fournisseur du modèle a renvoyé une erreur. Réessaie.",
    ai_busy: "L’assistant répond encore.",
    not_found:
      "Cette conversation est terminée (le serveur a redémarré). Ton prochain message en commence une nouvelle.",
    forbidden: "Parler à l’assistant demande la permission artisan.editor.edit.",
    network_error: "L’éditeur n’arrive pas à joindre le serveur.",
    unknown: "Quelque chose s’est mal passé. Réessaie.",
  },
};
