# Recommandation — organisation de l’éditeur

**REDESIGN ciblé : réorganiser la bibliothèque autour des éléments à placer et déplacer la gestion des fichiers dans les ressources du projet.**

Le problème principal est la confusion entre fichier importé, apparence d’un bouton, bouton placé et habillage du menu. Le design system, le canevas, les captures, le catalogue partagé et les fonctions d’édition existantes sont à préserver.

## Organisation proposée

```
Bibliothèque
└── Boutons
    ├── Items du jeu
    ├── Items capturés
    └── Images

Propriétés du menu
├── Apparence
│   ├── Fond du menu
│   ├── Décorations
│   └── Titre et textes
└── Réglages du menu

Projet → Ressources
├── Images de boutons
├── Fonds et décorations
└── Polices
```

Si « Boutons » devient le seul contenu de la bibliothèque, afficher directement un panneau intitulé « Boutons », avec ses trois onglets. Ne pas garder un onglet intermédiaire unique.

« Items du jeu » conserve les items de plugins aujourd’hui présents dans Catalogue, avec filtre Minecraft / Plugins. « Boutons » désigne la famille des éléments à placer ; une apparence n’est pas encore un bouton avec actions configurées. Le panneau doit l’indiquer sans alourdir les cartes.

Les fonds peuvent rester dans une bibliothèque au sens large si elle devient une palette d’insertion contextualisée. Dans l’organisation proposée, leur accès principal est « Apparence du menu → Fond », plus évident qu’un catalogue technique.

## Les cinq changements prioritaires

1. **Compréhension (#4)** — Regrouper les trois sources sous Boutons : Items du jeu, Items capturés, Images. Retirer Ressources graphiques de la palette d’insertion. Preuve : E1/E3.
2. **Utilité (#2)** — Séparer Fond du menu, Décorations et Titre/textes dans l’apparence du menu ; fournir un choix/import direct depuis chaque contexte. Preuve : E4.
3. **Simplicité (#10)** — Classer les images par usage, avec un fichier source unique et un double usage uniquement explicite. Preuve : E2.
4. **Utilité et détail (#2/#8)** — Uniformiser choisir puis placer, conserver le glisser-déposer et proposer une insertion accessible au clavier avec cible explicite. Preuve : E3/E6.
5. **Honnêteté et détail (#6/#8)** — Distinguer chargement, collection vide, recherche vide et erreur ; traduire les libellés, masquer les réglages techniques et mémoriser le contexte de navigation. Preuve : E5/E7.

## Classement des images

- Import depuis Boutons → Images : usage « Bouton » présélectionné.
- Import depuis Fond du menu : usage « Fond » présélectionné.
- Import depuis Décorations : usage « Décoration » présélectionné.
- Import depuis Ressources : demander l’usage ; conserver une catégorie À classer pour les anciens fichiers ambigus.
- Un même fichier peut servir dans deux contextes via une action explicite « Utiliser aussi comme… ». Ne pas dupliquer le fichier ni l’afficher partout par défaut.
- Une reclassification n’efface ni les placements ni les références existantes.
- Prévoir « Utilisée dans… » et distinguer « Retirer du menu » de « Supprimer du projet ».
- La dimension ou le ratio d’image peut aider à proposer une catégorie, jamais décider seul.
- Migration : analyser les références de boutons et de calques ; préserver le double usage existant ; laisser les cas indéterminés à classer sans casser le rendu.

## Parcours attendus

**Créer un bouton image** : ouvrir Boutons → Images → importer/choisir → prévisualiser l’emprise → placer → configurer les actions. L’aperçu distingue taille de l’image et zone cliquable. Une zone impossible doit être expliquée avant validation.

**Changer le fond** : sélectionner un menu → Apparence → Fond du menu → choisir/importer → aperçu → appliquer/remplacer. Le fond ne doit pas réserver de cases cliquables.

**Ajouter un logo** : menu → Apparence → Décorations → ajouter une image → positionner. Ne pas forcer un logo décoratif à devenir un fond complet ou un bouton.

**Capturer un item** : Boutons → Items capturés → Capturer depuis un joueur → choisir le joueur/item → réutiliser la capture. Si le serveur est indisponible, expliquer pourquoi l’acquisition est inaccessible tout en gardant la collection existante utilisable.

## Améliorations secondaires

- Remplacer « Armé / Désarmer » par « Clique sur une case pour placer… / Annuler le placement ».
- Conserver recherche, onglet et défilement par projet.
- Afficher les détails techniques de police uniquement dans Avancé.
- Normaliser focus, cibles tactiles et libellés de suppression.
- Harmoniser virtualisation et préchargement après mesure sur un projet représentatif.
- Préserver le chargement des ressources nécessaires au rendu même si leur gestionnaire est fermé.

## Mise en œuvre ultérieure

Aucun code fonctionnel modifié dans cet audit. Avant développement : faire valider cette organisation, puis préciser les écrans, la migration et les critères de recette. Les fonctionnalités seront traitées en TDD avec les docs correspondantes.
