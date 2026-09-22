# Passage à la planification

```text
/make-plan Réorganiser la bibliothèque et l’apparence des menus Artisan.

Verdict : REDESIGN ciblé : réorganiser la bibliothèque autour des éléments à placer et déplacer la gestion des fichiers dans les ressources du projet.

Pourquoi : l’UI mélange catalogue d’insertion et gestionnaire de fichiers ; toutes les images importées apparaissent comme boutons possibles, sans rôle fond/bouton. Le score partiel est 8/21 sur sept dimensions, sans total /30 faute de mesures visuelles/performance et de comparaison concurrentielle.

Utilisateur : administrateur Minecraft construisant un menu. Objectif : choisir ce qu’il veut ajouter, le placer et configurer son comportement sans connaître glyph/codepoint/ascent.

À préserver : tokens et composants du design system ; panneau redimensionnable et fermeture Escape (ProjectLibrary.tsx:49) ; catalogue Minecraft et plugins, captures existantes ; ressources partagées ; canevas et validations de géométrie (domain/imageButton.ts:57).

À retirer : onglets pairs Items / Ressources graphiques / Boutons image (ProjectLibrary.tsx:164), classement de tout non-font comme bouton (ImageButtonLibrary.tsx:45), paramètres techniques dans le parcours courant (AssetDetailPanel.tsx:71).

Changements prioritaires, repris de l’audit :
1. **Compréhension (#4)** — Regrouper les trois sources sous Boutons : Items du jeu, Items capturés, Images. Retirer Ressources graphiques de la palette d’insertion. Preuve : E1/E3.
2. **Utilité (#2)** — Séparer Fond du menu, Décorations et Titre/textes dans l’apparence du menu ; fournir un choix/import direct depuis chaque contexte. Preuve : E4.
3. **Simplicité (#10)** — Classer les images par usage, avec un fichier source unique et un double usage uniquement explicite. Preuve : E2.
4. **Utilité et détail (#2/#8)** — Uniformiser choisir puis placer, conserver le glisser-déposer et proposer une insertion accessible au clavier avec cible explicite. Preuve : E3/E6.
5. **Honnêteté et détail (#6/#8)** — Distinguer chargement, collection vide, recherche vide et erreur ; traduire les libellés, masquer les réglages techniques et mémoriser le contexte de navigation. Preuve : E5/E7.

Contexte des preuves : E1/E3 = ProjectLibrary.tsx:164 et Library.tsx:79, CapturedItemsSection.tsx:178, ImageButtonLibrary.tsx:16 ; E2 = AssetsTab.tsx:24 et ImageButtonLibrary.tsx:45 ; E4 = LayersPanel.tsx et domain/imageButton.ts:57 ; E5/E7 = AssetsTab.tsx:44, useAssetInit.ts:47, ImageButtonLibrary.tsx:70. Tous ces composants sont dans editor/src/features sauf domain/imageButton.ts.

Organisation proposée : Boutons contient Items du jeu / Items capturés / Images ; Apparence du menu contient Fond / Décorations / Titre et textes ; Ressources du projet gère Images de boutons / Fonds et décorations / Polices. Si Boutons est seul dans la bibliothèque, supprimer le niveau d’onglet unique. Conserver les items de plugins dans Items du jeu avec filtre d’origine.

Classification : usage présélectionné selon le point d’import, double usage explicite, un fichier source unique ; migration depuis les usages existants avec À classer pour ambiguïtés ; aucune suppression de références lors d’une reclassification. Les décorations ne doivent pas devenir artificiellement des fonds ou des boutons. Distinguer zone cliquable en cases et dimension d’image.

Livrables : architecture d’information, parcours avant/après et maquette ; changements par fichiers ; choix de stockage de classification ; migration et compatibilité anciens projets ; états loading/empty/no-result/error/success/focus/disabled ; recette clic/drag/clavier/mobile et suppression des ressources utilisées. Préserver le chargement des assets nécessaires au rendu avant ouverture de bibliothèque.

Contraintes : plan à valider avant code ; TDD pour les fonctionnalités ; design system existant ; français/anglais cohérents ; mises à jour docs architecture/editor-internals, docs utilisateur, et autres mappings concernés. Hors périmètre : refonte globale comptes/admin, protocole de rendu ou duplication des fichiers par usage. Ne pas exécuter l’implémentation depuis ce prompt.
```
