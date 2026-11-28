/** The HUD kind's page (modules/huds). */
export const hudsFr = {
  kindLabel: "HUD",
  summary: "{{lifetime}}, {{slot}}",
  where: "Où",
  slot: "Zone",
  slots: {
    boss_bar: "haut de l'écran",
    action_bar: "au-dessus de la barre d'action",
  },
  slotHint:
    "Les HUD d'une même zone s'empilent, par priorité. Les coins de l'écran viendront avec le shader du pack.",
  priority: "Priorité",
  priorityHint: "Le plus haut est dessiné par-dessus les autres de la même zone.",
  lifetime: "Affichage",
  lifetimes: {
    permanent: "Permanent",
    conditional: "Conditionnel",
    temporary: "Temporaire",
  },
  lifetimeHint: {
    permanent: "Toujours à l'écran des joueurs qui ont le pack.",
    conditional: "À l'écran tant que le joueur remplit ces conditions.",
    temporary:
      "Caché tant qu'une action « Afficher un HUD » (show_hud: {{id}}) ne le montre pas, pour une durée ou jusqu'à « Cacher un HUD ».",
  },
  onlyIf: "Seulement si",
  alsoIf: "Et seulement si",
  onlyIfEmpty: "Aucune condition : ajoutez-en une.",
  refresh: "Vérifié à nouveau",
  onChange: "au changement",
  every: "toutes les {{s}} s",
  refreshHint:
    "Un changement de variable le met à jour tout de suite. Ce délai sert aux valeurs qui changent sans prévenir (placeholders, position).",
  layout: "Disposition",
  layoutHint: "Glissez les couches sur l'écran du jeu.",
  newText: "Texte {{n}}",
  texts: "Textes",
  textsHint: "Taper { propose les valeurs du joueur et les variables.",
  noText: "Ajoutez une couche de texte à la disposition pour lui donner un texte.",
};

export const hudsEn: typeof hudsFr = {
  kindLabel: "HUD",
  summary: "{{lifetime}}, {{slot}}",
  where: "Where",
  slot: "Area",
  slots: {
    boss_bar: "top of the screen",
    action_bar: "above the action bar",
  },
  slotHint:
    "HUDs in the same area stack by priority. The screen's corners will come with the pack's shader.",
  priority: "Priority",
  priorityHint: "The highest is drawn over the others in the same area.",
  lifetime: "Display",
  lifetimes: {
    permanent: "Permanent",
    conditional: "Conditional",
    temporary: "Temporary",
  },
  lifetimeHint: {
    permanent: "Always on the screen of the players who have the pack.",
    conditional: "On screen while the player meets these conditions.",
    temporary:
      "Hidden until a “Show a HUD” action (show_hud: {{id}}) shows it, for a duration or until “Hide a HUD”.",
  },
  onlyIf: "Only if",
  alsoIf: "And only if",
  onlyIfEmpty: "No condition: add one.",
  refresh: "Checked again",
  onChange: "on change",
  every: "every {{s}} s",
  refreshHint:
    "A change of Variable updates it at once. This delay is for values that change without notice (placeholders, position).",
  layout: "Layout",
  layoutHint: "Drag the layers on the game's screen.",
  newText: "Text {{n}}",
  texts: "Texts",
  textsHint: "Typing { offers the player's values and the Variables.",
  noText: "Add a text layer to the layout to give it a text.",
};
