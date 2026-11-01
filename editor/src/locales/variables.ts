/** The Variable kind's page (modules/variables). */
export const variablesFr = {
  kindLabel: "Variable",
  summary: "{{type}}, {{scope}}",
  value: "Valeur",
  type: "Type",
  types: {
    string: "Texte",
    number: "Nombre",
    boolean: "Oui / non",
    location: "Position",
  },
  scope: "Portée",
  scopes: {
    player: "par joueur",
    server: "pour tout le serveur",
  },
  scopeHint: {
    player:
      "Une valeur par joueur. Elle le suit sur tous les serveurs du réseau qui partagent la base de données.",
    server: "Une seule valeur, la même pour tous les joueurs de tous les serveurs du réseau.",
  },
  default: "Valeur par défaut",
  defaultHint:
    "Lue tant que rien n'est enregistré. « est définie » (has_var) reste faux : la valeur par défaut ne compte pas.",
  badDefault: "Cette valeur n'est pas de type {{type}} : le serveur refusera la variable.",
  expires: "Oubliée après",
  seconds: "secondes sans écriture",
  never: "jamais",
  none: "aucune",
  true: "oui",
  false: "non",
  usage: "S'utilise ainsi",
  usageText: "Dans un texte",
  usageSet: "Une valeur est enregistrée",
  usageTrue: "Comme condition",
  usageWrite: "Écrire",
  usageAdd: "Ajouter 1",
  usageTeleport: "Téléporter",
  usageClear: "Effacer",
  usagePapi: "PlaceholderAPI",
};

export const variablesEn: typeof variablesFr = {
  kindLabel: "Variable",
  summary: "{{type}}, {{scope}}",
  value: "Value",
  type: "Type",
  types: {
    string: "Text",
    number: "Number",
    boolean: "Yes / no",
    location: "Location",
  },
  scope: "Scope",
  scopes: {
    player: "per player",
    server: "server-wide",
  },
  scopeHint: {
    player:
      "One value per player. It follows them on every server of the network that shares the database.",
    server: "One value, the same for every player on every server of the network.",
  },
  default: "Default value",
  defaultHint:
    'Read while nothing is stored. "is set" (has_var) stays false: the default does not count.',
  badDefault: "This value is not a {{type}}: the server will refuse the variable.",
  expires: "Forgotten after",
  seconds: "seconds without a write",
  never: "never",
  none: "none",
  true: "yes",
  false: "no",
  usage: "How to use it",
  usageText: "In a text",
  usageSet: "A value is stored",
  usageTrue: "As a condition",
  usageWrite: "Write",
  usageAdd: "Add 1",
  usageTeleport: "Teleport",
  usageClear: "Clear",
  usagePapi: "PlaceholderAPI",
};
